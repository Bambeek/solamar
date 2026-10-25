// Built-in ad and tracker blocking (Ghostery's engine with EasyList/EasyPrivacy-class prebuilt lists).
// The engine is cached in userData; the first run downloads it, browsing works unblocked until it is ready.
//
// Network blocking is the library's. Cosmetics are split: uBlock Origin's scriptlets (+js rules such as json-prune,
// set-constant, abort-on-property-read, which are what actually stop YouTube's video ads and Google's link tricks) and
// the first stylesheet come from Solamar's page preload (src/preload/page.ts), which asks COSMETICS_CHANNEL
// synchronously and runs them in every frame's main world before the page's first script. The library's own
// injection ran them after an async round trip with webContents.executeJavaScript, which waits until the page has
// finished loading (too late to patch the player config) and rejected with "Script failed to execute" whenever one
// threw; its preload is now only used for the later, DOM-driven hiding rules (see narrowLibraryInjection).
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { ElectronBlocker, Request } from '@ghostery/adblocker-electron'
import { ipcMain, type IpcMainEvent, type OnBeforeRequestListenerDetails, type OnHeadersReceivedListenerDetails, type Session } from 'electron'

/** Sync IPC from src/preload/page.ts, once per frame at document start (same literal there). */
export const COSMETICS_CHANNEL = 'solamar:adblock-cosmetics'
/** What a frame gets back: a user-origin stylesheet and the scriptlets to run in its main world, or null. */
export type FrameCosmetics = { styles: string; scripts: string[] } | null

const isWeb = (url: string) => /^https?:\/\//i.test(url)
const hostname = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}
/**
 * The top-level page a request belongs to, so "ads allowed on this site" covers the whole tab, iframes from other
 * sites included. The engine cannot do this: it applies `@@||site^$document` to the page request only, never to
 * the scripts and calls the page makes.
 */
function pageOf(d: OnBeforeRequestListenerDetails | OnHeadersReceivedListenerDetails): string {
  if (d.resourceType === 'mainFrame') return d.url
  try {
    const top = d.frame?.top?.url
    if (top) return top
  } catch {
    // the frame is already gone
  }
  try {
    const page = d.webContents?.getURL()
    if (page) return page
  } catch {}
  return d.referrer || d.initiatorOrigin || ''
}
/** Requests an extension makes itself; a content blocker in Chrome never sees those. */
const fromExtension = (d: OnBeforeRequestListenerDetails) => /^chrome-extension:/.test(d.initiatorOrigin ?? '') || /^chrome-extension:/.test(d.referrer)

/** Hostname and registrable domain the way the engine matches them (`google.*` style rules need the domain). */
const place = (url: string) => {
  const r = Request.fromRawDetails({ url })
  return { hostname: r.hostname, domain: r.domain }
}
// Site fixes in the lists (uBlock Origin quick fixes, unbreak) change every few days; a stale engine starts hiding
// the wrong things, so the cached engine is rebuilt once a day.
const MAX_AGE_MS = 24 * 60 * 60 * 1000

// The library registers these as global IPC handlers every time it is enabled in a session, which throws for a
// second session (profiles, the private space). Its handlers only use the shared engine and the sender, so the
// previous pair is dropped before enabling another session.
const COSMETIC_CHANNELS = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled']
function enableIn(blocker: ElectronBlocker, session: Session): void {
  if (blocker.isBlockingEnabled(session)) return
  for (const c of COSMETIC_CHANNELS) ipcMain.removeHandler(c)
  blocker.enableBlockingInSession(session)
}

export class AdBlock {
  private blocker: ElectronBlocker | null = null
  private sessions = new Set<Session>()
  private allow = new Set<string>()
  private enabled = true
  private cachePath = ''
  readonly counts = new Map<number, number>() // webContents id -> blocked requests since last navigation
  onBlocked: (webContentsId: number) => void = () => {}

  constructor() {
    // One listener for every session (profiles, the private space), registered before any page can load: a
    // sendSync without a listener would hang the page, so this always answers, with null when nothing applies.
    ipcMain.on(COSMETICS_CHANNEL, (event: IpcMainEvent, frame: unknown) => {
      let reply: FrameCosmetics = null
      try {
        reply = this.frameCosmetics(event.sender.session, frame)
      } catch (err) {
        console.error('[adblock] could not build cosmetics for a frame', err)
      }
      event.returnValue = reply
    })
  }

  get ready(): boolean {
    return this.blocker !== null
  }

  async init(cachePath: string, enabled: boolean, allowlist: string[]): Promise<void> {
    this.enabled = enabled
    this.cachePath = cachePath
    this.setAllowlist(allowlist)
    await this.load(false)
    setInterval(() => void this.load(true), MAX_AGE_MS).unref()
  }

  /** Loads the engine (from the cache unless it is older than a day) and swaps it in for every session. */
  private async load(refresh: boolean): Promise<void> {
    const cachePath = this.cachePath
    const old = this.blocker
    try {
      const age = await stat(cachePath).then((s) => Date.now() - s.mtimeMs, () => Infinity)
      if (refresh || age > MAX_AGE_MS) await rm(cachePath, { force: true })
      const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: cachePath,
        read: async (p) => new Uint8Array(await readFile(p)),
        write: (p, buf) => writeFile(p, buf)
      })
      blocker.on('request-blocked', (req) => {
        const id = req.tabId
        if (typeof id !== 'number') return
        this.counts.set(id, (this.counts.get(id) ?? 0) + 1)
        this.onBlocked(id)
      })
      this.narrowLibraryInjection(blocker)
      this.gateLibraryBlocking(blocker)
      if (old) for (const s of this.sessions) if (old.isBlockingEnabled(s)) old.disableBlockingInSession(s)
      this.blocker = blocker
      if (this.enabled) for (const s of this.sessions) enableIn(blocker, s)
    } catch (err) {
      console.error('[adblock] could not load filter lists; browsing continues without blocking', err)
    }
  }

  /** Off for the whole browser, or the page's top-level site is on the allowlist ("ads allowed here"). */
  private isOff(topUrl: string): boolean {
    if (!this.enabled) return true
    const host = hostname(topUrl)
    for (const d of this.allow) if (host === d || host.endsWith('.' + d)) return true
    return false
  }

  /**
   * Styles and scriptlets for one frame at document start. `frame` comes from the page preload: the frame's URL and
   * location.ancestorOrigins (parent first, top-level page last), so subframes are matched with their parents.
   */
  frameCosmetics(session: Session, frame: unknown): FrameCosmetics {
    const blocker = this.blocker
    if (!blocker || !blocker.isBlockingEnabled(session)) return null
    const info = (frame ?? {}) as { url?: unknown; ancestors?: unknown }
    const url = typeof info.url === 'string' ? info.url : ''
    const ancestors = Array.isArray(info.ancestors) ? info.ancestors.filter((a): a is string => typeof a === 'string' && isWeb(a)) : []
    // about:blank and srcdoc frames run with the page that made them, so they get that page's rules.
    const pageUrl = isWeb(url) ? url : ancestors[0]
    if (!pageUrl || this.isOff(ancestors.length ? ancestors[ancestors.length - 1] : pageUrl)) return null
    const { active, styles, scripts } = blocker.getCosmeticsFilters({
      url: pageUrl,
      ...place(pageUrl),
      ancestors: ancestors.length ? ancestors.map(place) : undefined,
      getBaseRules: true,
      getInjectionRules: true,
      getExtendedRules: false,
      getRulesFromHostname: true,
      getRulesFromDOM: false
    })
    if (!active || (!styles && scripts.length === 0)) return null
    return { styles, scripts }
  }

  /**
   * The library's preload still asks for cosmetics: once at start (already done by Solamar's preload, so ignored) and
   * then whenever its MutationObserver sees new ids/classes/hrefs, which unlocks generic hiding rules for them. Those
   * updates are answered here with styles only, never scripts, and nothing at all when blocking is off for the page.
   * The library calls this property on every IPC message, so replacing it on the instance is enough.
   */
  private narrowLibraryInjection(blocker: ElectronBlocker): void {
    blocker.onInjectCosmeticFilters = async (event, url, msg) => {
      if (msg === undefined || !isWeb(url) || this.isOff(event.sender.getURL() || url)) return
      const { active, styles } = blocker.getCosmeticsFilters({
        url,
        ...place(url),
        classes: msg.classes,
        hrefs: msg.hrefs,
        ids: msg.ids,
        getBaseRules: false,
        getInjectionRules: false,
        getExtendedRules: false,
        getRulesFromHostname: false,
        getRulesFromDOM: true
      })
      if (active && styles) await event.sender.insertCSS(styles, { cssOrigin: 'user' }).catch(() => {})
    }
  }

  /**
   * Network blocking and CSP injection go through Solamar first: nothing is blocked in a tab whose site is on the
   * allowlist or for an extension's own requests. A request without a referrer (no-referrer policies, Cloudflare's
   * challenge scripts) is matched as coming from its frame, so `$domain=` exceptions and `$third-party` still apply.
   * The library looks these methods up on the instance for every request, so replacing them is enough.
   */
  private gateLibraryBlocking(blocker: ElectronBlocker): void {
    const block = blocker.onBeforeRequest
    const headers = blocker.onHeadersReceived
    blocker.onBeforeRequest = (details, callback) => {
      if (fromExtension(details) || this.isOff(pageOf(details))) return callback({})
      if (details.referrer) return block(details, callback)
      let source = details.initiatorOrigin ?? ''
      try {
        source = details.frame?.url || source
      } catch {}
      block({ ...details, referrer: source }, callback)
    }
    blocker.onHeadersReceived = (details, callback) => (this.isOff(pageOf(details)) ? callback({}) : headers(details, callback))
  }

  attach(session: Session): void {
    this.sessions.add(session)
    if (this.blocker && this.enabled) enableIn(this.blocker, session)
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!this.blocker) return
    for (const s of this.sessions) {
      if (on) enableIn(this.blocker, s)
      else if (this.blocker.isBlockingEnabled(s)) this.blocker.disableBlockingInSession(s)
    }
  }

  setAllowlist(domains: string[]): void {
    this.allow = new Set(domains.map((d) => d.toLowerCase()).filter(Boolean))
  }

  resetCount(webContentsId: number): void {
    this.counts.delete(webContentsId)
  }
}
