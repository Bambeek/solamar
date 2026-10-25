// Window, views and tab lifecycle. One BaseWindow holds three kinds of views, bottom to top:
//   ui      - the frame: background, sidebar, AI panel (renderer #ui)
//   tabs    - one WebContentsView per awake tab, placed in the content rect (split shows two)
//   overlay - command bar and dialogs (renderer #overlay), transparent, only attached while open
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join, sep } from 'node:path'
import {
  app,
  BaseWindow,
  clipboard,
  dialog,
  Menu,
  MenuItem,
  nativeTheme,
  Notification,
  powerMonitor,
  systemPreferences,
  screen,
  session as electronSession,
  shell,
  WebContentsView,
  type Input,
  type Session,
  type WebContents
} from 'electron'
import { COMMAND_LABELS } from '@shared/defaults'
import type {
  AiFeature,
  AiState,
  AnswerState,
  Boost,
  BoostEditorState,
  Bounds,
  DownloadEntry,
  Notice,
  ExtensionInstallPrompt,
  MediaState,
  PageAgentState,
  PageAgentTurn,
  PeekState,
  SavePasswordPrompt,
  HistoryEntry,
  AppState,
  CommandId,
  CommandResult,
  Item,
  OverlayKind,
  OverlayState,
  PageSnapshot,
  PermissionRequest,
  Section,
  Space,
  SpaceTheme,
  TabRuntime,
  WriteState
} from '@shared/types'
import { accelerator, boostCss, boostMatches, firefoxUserAgent, frameColors, GOOGLE_SIGN_IN_HOSTS, hostOf, isEmptyBoost, normalizeAccelerator, siteOf, toNavigable, uid } from '@shared/util'
import { AdBlock } from './adblock'
import { PAGE_TEXT_LIMIT, askPrompt, parseTidy, summarizePrompt, tidyPrompt, type ChatMessage } from './ai'
import { AgentHost } from './agent'
import { AGENT_WORLD, applyFieldJs, fieldJs, type FieldInfo } from './agent-dom'
import { anthropicWebAnswer, claudeCodeWebAnswer, cleanEdit, cleanQuery, linksIn, localAnswerPrompt, looksLikeQuestion, replyPrompt, rewritePrompt, type WriteAction, writePrompt } from './assist'
import { claudeCliVersion } from './claude-cli'
import { anthropicClient, anthropicEngine, checkAnthropicKey, claudeCodeEngine, claudeCodeEngineAllowed, describeEngineError, type Engine, engineFor, ollamaEngine, ollamaStatus } from './engines'
import { UNTRUSTED_RULE, wrapUntrusted } from './guard'
import type { Secrets } from './secrets'
import { agentSystemPrompt, runAgentWithApi, runAgentWithClaudeCode } from './page-agent'
import { saveClip } from './clips'
import { Updates } from './updates'
import { BOOST_WORLD, mediaJs, zapJs, zapStopJs } from './page-tools'
import { SessionState } from './session-state'
import { Extensions } from './extensions'
import { originOf, VaultLockedError, type Vault } from './vault'
import { osAuthKind, osVerify, type OsAuthKind } from './os-auth'
import { type ActionDef, rankResults, tabsToArchive, tabsToSleep } from './policy'
import type { Store } from './store'

const PAD = 8
const LAYOUT_ANIM_MS = 220 // keep in step with --motion-layout in app.css
const ASKABLE = ['media', 'geolocation', 'notifications', 'midi', 'display-capture', 'idle-detection']
const TOPBAR = 40
const BAR = 46 // bar layout: the top bar with spaces and the address
const ROW = 38 // bar layout: the row of tabs under the top bar
const AI_WIDTH = 380
const RADIUS = 10
const MAC = process.platform === 'darwin'
const MAX_AGENT_TURNS = 10 // earlier page agent turns kept in a conversation

// The project (or app.asar) root: out/main/index.js sits two levels down, wherever Electron was started from.
const ROOT = join(__dirname, '..', '..')

const rendererUrl = (hash: string) =>
  process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}#${hash}` : `file://${join(__dirname, '../renderer/index.html')}#${hash}`

const ACTIONS: ActionDef[] = [
  { id: 'space-new', title: 'New space', keywords: 'create workspace' },
  { id: 'theme', title: 'Edit space theme', keywords: 'colour color appearance gradient' },
  { id: 'import-arc', title: 'Import from Arc', keywords: 'migrate spaces arc browser' },
  { id: 'import-browser', title: 'Import from Chrome, Edge, Firefox or Safari', keywords: 'bookmarks history migrate brave' },
  { id: 'settings', title: 'Settings', keywords: 'preferences options' },
  { id: 'archive', title: 'Archived tabs', keywords: 'closed' },
  { id: 'history', title: 'History', keywords: 'visited pages past' },
  { id: 'downloads', title: 'Downloads', keywords: 'files saved' },
  { id: 'privateSpace', title: 'Private space (incognito)', keywords: 'incognito private window' },
  { id: 'toggleSidebar', title: 'Show or hide sidebar', keywords: 'focus compact' },
  { id: 'splitView', title: 'Split view with next tab', keywords: 'side by side' },
  { id: 'pinTab', title: 'Pin or unpin tab', keywords: 'keep' },
  { id: 'copyUrl', title: 'Copy page address', keywords: 'link url' },
  { id: 'aiSummarize', title: 'Summarize this page (AI)', keywords: 'ai tldr ollama claude' },
  { id: 'aiTidy', title: 'Tidy today tabs into folders (AI)', keywords: 'ai organize group' },
  { id: 'aiPanel', title: 'AI panel', keywords: 'ai ask chat ollama claude' },
  { id: 'aiWrite', title: 'Write with AI in the focused field', keywords: 'ai rewrite grammar compose reply' },
  { id: 'save-for-claude', title: 'Save page for Claude', keywords: 'clone copy download inspiration claude code design screenshot' },
  { id: 'boost', title: 'Boost this site (colours, font, zap, code)', keywords: 'customize css js style hide element zap font colour' },
  { id: 'adblock-site', title: 'Turn ad blocking off / on for this site', keywords: 'adblock allow shield' },
  { id: 'devtools', title: 'Developer tools', keywords: 'inspect console' }
]

/**
 * macOS: Command does what Ctrl does on Windows, so shortcuts stay written as Ctrl+T. Control plus a letter stays
 * with the page (it moves the cursor in text fields there); Control+Tab still switches tabs.
 */
function macShortcut(acc: string): string {
  const parts = acc.split('+')
  const key = parts.pop() ?? ''
  const mods = new Set(parts)
  if (mods.has('Meta')) {
    mods.delete('Meta')
    mods.add('Ctrl')
  } else if (mods.has('Ctrl') && key !== 'Tab') return ''
  return [...['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)), key].join('+')
}

export class Browser {
  readonly win: BaseWindow
  private readonly ui: WebContentsView
  private readonly overlay: WebContentsView
  private overlayState: OverlayState | null = null
  private readonly views = new Map<string, WebContentsView>()
  private readonly attached = new Set<WebContentsView>()
  private readonly wcToItem = new Map<number, string>()
  private readonly runtime: Record<string, TabRuntime> = {}
  private readonly sessions = new Set<Session>()
  private readonly closed: { url: string; title?: string; spaceId: string | null }[] = []
  private fullscreenId: string | null = null
  private shortcutsSuspended = false
  private pushTimer: NodeJS.Timeout | null = null
  private aiAbort: AbortController | null = null
  ai: AiState = { panelOpen: false, available: null, models: [], hasKey: false, keyStorage: false, claudeCodeAllowed: claudeCodeEngineAllowed(), busy: false, messages: [], tidy: null }
  readonly agent: AgentHost

  restoredAfterCrash = false
  readonly sessionState: SessionState
  readonly extensions: Extensions

  constructor(
    private readonly store: Store,
    private readonly adblock: AdBlock,
    private readonly secrets: Secrets,
    readonly vault: Vault
  ) {
    this.sessionState = new SessionState(join(app.getPath('userData'), 'session.json'), join(app.getPath('userData'), 'running.lock'))
    this.restoredAfterCrash = this.sessionState.crashed
    if (this.restoredAfterCrash)
      setTimeout(() => this.restoredAfterCrash && this.showNotice({ text: 'Solamar did not close properly. Your tabs, their history and what you typed are back.' }, 20_000), 1500)
    this.agent = new AgentHost(this, store, secrets)
    this.agent.onChange = () => this.push()
    this.ai.hasKey = secrets.has('anthropicKey')
    this.ai.keyStorage = secrets.available
    const w = this.doc.window
    const area = screen.getPrimaryDisplay().workArea
    const bounds = w.bounds ?? { width: Math.min(1440, area.width), height: Math.min(920, area.height), x: undefined as any, y: undefined as any }
    this.win = new BaseWindow({
      ...bounds,
      minWidth: 640,
      minHeight: 420,
      // macOS keeps its own traffic lights, over the left end of Solamar's top bar; elsewhere Solamar draws the buttons.
      frame: MAC,
      ...(MAC ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: this.trafficLights() } : {}),
      show: process.env.SOLAMAR_HIDDEN !== '1',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#121118' : '#f6f5fa',
      title: 'Solamar',
      icon: this.appIconPath(process.platform === 'win32' ? 'ico' : 'png')
    })
    this.applyAppIcon()
    if (w.maximized && process.env.SOLAMAR_HIDDEN !== '1') this.win.maximize()
    this.extensions = new Extensions({
      win: this.win,
      createTab: (url, active, ses) => {
        const usesSession = (s: Space) => electronSession.fromPartition((this.doc.profiles.find((p) => p.id === s.profileId) ?? this.doc.profiles[0]).partition) === ses
        const space = usesSession(this.space()) ? this.space() : (this.doc.spaces.find(usesSession) ?? this.space())
        return this.ensureView(this.openTab(url, { activate: active, spaceId: space.id })).webContents
      },
      selectTab: (wc) => {
        const id = this.wcToItem.get(wc.id)
        if (id) this.activate(id)
      },
      closeTab: (wc) => {
        const id = this.wcToItem.get(wc.id)
        if (id) this.closeTab(id)
      },
      confirmInstall: (prompt) => this.confirmExtensionInstall(prompt)
    })

    const prefs = { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
    this.ui = new WebContentsView({ webPreferences: prefs })
    this.ui.setBackgroundColor('#00000000')
    this.overlay = new WebContentsView({ webPreferences: prefs })
    this.overlay.setBackgroundColor('#00000000')
    this.win.contentView.addChildView(this.ui)
    for (const wc of [this.ui.webContents, this.overlay.webContents]) {
      wc.on('before-input-event', (e, input) => this.onKey(e, input))
      wc.setWindowOpenHandler(({ url }) => {
        if (/^https?:/.test(url)) this.openTab(url)
        return { action: 'deny' }
      })
      wc.on('will-navigate', (e) => e.preventDefault())
    }
    this.ui.webContents.loadURL(rendererUrl('ui')).catch(() => {})
    this.overlay.webContents.loadURL(rendererUrl('overlay')).catch(() => {})

    this.win.on('resize', () => {
      this.layout()
      if (this.peek) this.push() // the peek card follows the page
    })
    this.win.on('maximize', () => this.onWindowState())
    this.win.on('unmaximize', () => this.onWindowState())
    this.win.on('focus', () => this.focusContent())
    this.win.on('close', () => this.saveBounds())
    nativeTheme.on('updated', () => this.push())
    this.setupVaultProtection()

    adblock.onBlocked = (wcId) => {
      if (this.wcToItem.has(wcId)) this.push()
    }

    // Start with the focused space's active tab only; everything else wakes on click.
    const active = this.activeId()
    if (active) this.ensureView(active)
    this.layout()
    setInterval(() => this.housekeeping(), 60_000).unref()
    setInterval(() => this.saveSessions(), 15_000).unref()
  }

  // ---------- state ----------

  get doc() {
    return this.store.doc
  }

  getItem(id: string | null | undefined): Item | undefined {
    return this.item(id)
  }

  private item(id: string | null | undefined): Item | undefined {
    return id ? this.doc.items.find((i) => i.id === id) : undefined
  }

  private space(id = this.doc.window.focusedSpaceId): Space {
    return this.doc.spaces.find((s) => s.id === id) ?? this.doc.spaces[0]
  }

  activeId(): string | null {
    const id = this.doc.window.activeBySpace[this.doc.window.focusedSpaceId] ?? null
    return this.item(id) ? id : null
  }

  private visibleIds(): string[] {
    const a = this.activeId()
    if (!a) return []
    if (this.fullscreenId) return [this.fullscreenId]
    const split = this.doc.window.split.filter((id) => this.item(id))
    return split.includes(a) && split.length > 1 ? split : [a]
  }

  /** Re-layout and push state after outside changes (settings, imports, ad block ready). */
  refresh(): void {
    this.layout()
    this.push()
  }

  private changed(save = true): void {
    if (save) this.store.save()
    this.push()
  }

  private push(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      const state = this.snapshot()
      for (const v of [this.ui, this.overlay]) if (!v.webContents.isDestroyed()) v.webContents.send('solamar:state', state)
    }, 16)
  }

  snapshot(): AppState {
    const runtime: Record<string, TabRuntime> = {}
    for (const [id, rt] of Object.entries(this.runtime)) {
      const wc = this.views.get(id)?.webContents
      runtime[id] = { ...rt, blocked: wc ? (this.adblock.counts.get(wc.id) ?? 0) : 0 }
    }
    const { history: _h, archive, downloads: _d, ...doc } = this.doc
    return {
      ...doc,
      activeId: this.activeId(),
      runtime,
      overlay: this.overlayState,
      ai: this.ai,
      agent: this.agent.state(),
      confirm: this.agent.currentConfirm(),
      permission: this.permQueue[0]?.req ?? null,
      write: this.write,
      layoutSnapshot: this.layoutSnapshot,
      answer: this.answer,
      adblockReady: this.adblock.ready,
      maximized: this.win.isMaximized(),
      archiveCount: archive.length,
      restoredAfterCrash: this.restoredAfterCrash,
      downloads: this.doc.downloads.slice(0, 30),
      peek: this.peek ? { ...this.peek, rect: this.peekRect() } : null,
      savePassword: this.savePrompt?.prompt ?? null,
      pageAgent: this.pageAgent,
      notice: this.notice,
      update: this.updates.state,
      clipsRoot: this.clipsRoot(),
      ...this.extensionState(),
      passwords: { available: this.vault.available, count: this.vault.count, locked: this.vault.locked, master: this.vault.hasMaster, osAuth: this.osAuth },
      media: this.mediaState(),
      boostEditor: this.boostEditor,
      platform: process.platform
    }
  }

  // ---------- layout ----------

  // ---------- animated layout (sidebar, AI panel) ----------

  layoutSnapshot: PageSnapshot[] | null = null
  private animating = false
  private layoutFrozen = false // while true, layout() leaves page views detached (their pictures are animating)

  private richAnimations(): boolean {
    try {
      return systemPreferences.getAnimationSettings().shouldRenderRichAnimation
    } catch {
      return true
    }
  }

  /**
   * Applies a change that moves the page area (sidebar, AI panel) with a slide instead of a jump.
   * Resizing a live web page every frame stutters (heavy pages relayout each step and drift out of sync with the
   * frame), so the pages are swapped for still pictures that slide with the frame's CSS transition, and the real
   * pages are resized once at the end.
   */
  private async animateLayout(change: () => void): Promise<void> {
    const instant = () => {
      change()
      this.layout()
      this.push()
    }
    if (this.animating || !this.richAnimations()) return instant()
    const from = this.contentRect()
    const views = this.visibleIds()
      .map((id) => this.views.get(id))
      .filter((v): v is WebContentsView => !!v && this.attached.has(v))
    const shots = await Promise.all(
      views.map(async (v) => {
        const b = v.getBounds()
        const img = await Promise.race([v.webContents.capturePage(), new Promise<null>((r) => setTimeout(() => r(null), 150))]).catch(() => null)
        if (!img || img.isEmpty()) return null
        return { src: 'data:image/jpeg;base64,' + img.toJPEG(88).toString('base64'), x: b.x - from.x, y: b.y - from.y, width: b.width, height: b.height }
      })
    )
    if (shots.some((s) => !s) || this.animating) return instant()
    this.animating = true
    try {
      this.layoutSnapshot = shots as PageSnapshot[]
      this.push()
      await new Promise((r) => setTimeout(r, 40)) // the frame paints the pictures under the real pages first
      this.layoutFrozen = true
      for (const v of views) {
        this.win.contentView.removeChildView(v)
        this.attached.delete(v)
      }
      change()
      this.layout()
      this.push() // the frame starts its transition; the pictures ride along inside the page area
      await new Promise((r) => setTimeout(r, LAYOUT_ANIM_MS + 20))
    } finally {
      this.layoutFrozen = false
      this.layout() // real pages, once, at their final size
      setTimeout(() => {
        this.layoutSnapshot = null
        this.animating = false
        this.push()
      }, 80)
    }
  }

  private contentRect() {
    const { width: w, height: h } = this.win.getContentBounds()
    const s = this.doc.settings
    const bar = s.layout === 'bar'
    const left = bar ? PAD : s.sidebarVisible ? s.sidebarWidth : PAD
    const top = bar ? BAR + (s.sidebarVisible ? ROW : 0) : s.sidebarVisible ? PAD : TOPBAR
    const right = PAD + (this.ai.panelOpen || this.boostEditor ? AI_WIDTH : 0)
    return { x: left, y: top, width: Math.max(100, w - left - right), height: Math.max(100, h - top - PAD), w, h }
  }

  /** Where macOS draws the traffic lights: centred on the top bar (bar layout) or the sidebar's top row. */
  private trafficLights(): { x: number; y: number } {
    return { x: 16, y: this.doc.settings.layout === 'bar' ? 17 : 15 }
  }

  layout(): void {
    if (MAC) this.win.setWindowButtonPosition(this.trafficLights())
    const r = this.contentRect()
    this.ui.setBounds({ x: 0, y: 0, width: r.w, height: r.h })
    const visible = this.layoutFrozen ? [] : this.visibleIds()
    for (const [id, v] of this.views) {
      if (!visible.includes(id) && this.attached.has(v)) {
        this.win.contentView.removeChildView(v)
        this.attached.delete(v)
      }
    }
    const full = this.fullscreenId && this.win.isFullScreen()
    const gap = PAD
    const each = (r.width - gap * (visible.length - 1)) / Math.max(1, visible.length)
    visible.forEach((id, i) => {
      const v = this.ensureView(id)
      if (!this.attached.has(v)) {
        this.win.contentView.addChildView(v)
        this.attached.add(v)
      }
      v.setBorderRadius(full ? 0 : RADIUS)
      v.setBounds(full ? { x: 0, y: 0, width: r.w, height: r.h } : { x: Math.round(r.x + i * (each + gap)), y: r.y, width: Math.round(each), height: r.height })
    })
    if (this.overlayState) {
      this.win.contentView.addChildView(this.overlay) // re-adding moves it to the top
      // A permission prompt is a small card under the address field, so the page stays usable.
      const small = this.overlayState.kind === 'permission' || this.overlayState.kind === 'save-password' || this.overlayState.kind === 'vault-unlock'
      const s = this.doc.settings
      const bar = s.layout === 'bar'
      this.overlay.setBounds(
        this.overlayState.kind === 'notice'
          ? // A strip at the bottom, above the page (the frame below the pages could not show it).
            { x: Math.max(8, Math.round(r.w / 2 - 290)), y: Math.max(0, r.h - 86), width: Math.min(580, r.w - 16), height: 76 }
          : small
          ? s.sidebarVisible && !bar
            ? { x: 6, y: 78, width: 380, height: this.overlayState.kind === 'vault-unlock' ? 240 : 200 }
            : { x: Math.max(8, Math.round(r.w / 2 - 190)), y: bar ? r.y : TOPBAR, width: 380, height: this.overlayState.kind === 'vault-unlock' ? 240 : 200 }
          : { x: 0, y: 0, width: r.w, height: r.h }
      )
      if (this.overlayState.kind === 'peek' && this.peekView) {
        this.win.contentView.addChildView(this.peekView) // above the overlay, which draws the card around it
        this.peekView.setBounds(this.peekRect())
      }
    }
  }

  private onWindowState(): void {
    this.doc.window.maximized = this.win.isMaximized()
    this.layout()
    this.changed()
  }

  // ---------- moving the window by its top bar ----------

  private drag: { sx: number; sy: number; wx: number; wy: number } | null = null

  /** Screen coordinates come from the frame's pointer events (DIP), so the window follows the cursor exactly. */
  windowDrag(phase: 'start' | 'move' | 'end', x: number, y: number): void {
    if (phase === 'start') {
      if (this.win.isMaximized()) {
        // Like Windows: dragging a maximized window restores it under the cursor, at the same relative spot.
        const max = this.win.getBounds()
        const normal = this.doc.window.bounds ?? { x: max.x, y: max.y, width: Math.round(max.width * 0.7), height: Math.round(max.height * 0.8) }
        const fx = Math.min(1, Math.max(0, (x - max.x) / max.width))
        this.win.unmaximize()
        this.win.setBounds({ x: Math.round(x - fx * normal.width), y: Math.round(y - 14), width: normal.width, height: normal.height })
      }
      const [wx, wy] = this.win.getPosition()
      this.drag = { sx: x, sy: y, wx, wy }
      return
    }
    const d = this.drag
    if (!d) return
    this.win.setPosition(Math.round(d.wx + x - d.sx), Math.round(d.wy + y - d.sy))
    if (phase === 'end') {
      this.drag = null
      // Let go at the top edge of a screen: maximize there, as Windows does.
      const area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea
      if (y <= area.y + 2) this.win.maximize()
      this.saveBounds()
    }
  }

  saveBounds(): void {
    if (!this.win.isMaximized() && !this.win.isMinimized() && !this.win.isFullScreen()) this.doc.window.bounds = this.win.getBounds()
    this.doc.window.maximized = this.win.isMaximized()
    this.store.save()
  }

  private focusContent(): void {
    if (this.overlayState) (this.overlayState.kind === 'peek' && this.peekView ? this.peekView : this.overlay).webContents.focus()
    else {
      const a = this.activeId()
      const v = a && this.views.get(a)
      if (v) v.webContents.focus()
    }
  }

  // ---------- tabs ----------

  private partitionFor(item: Item): string {
    const space = item.spaceId ? this.space(item.spaceId) : this.space()
    return (this.doc.profiles.find((p) => p.id === space.profileId) ?? this.doc.profiles[0]).partition
  }

  private setupSession(ses: Session): void {
    if (this.sessions.has(ses)) return
    this.sessions.add(ses)
    ses.setUserAgent(app.userAgentFallback) // plain Chrome UA (set in index.ts), also for partitions
    // Google's sign-in pages get Firefox's user agent and no Chrome client hints (see firefoxUserAgent); the page
    // preload makes navigator agree, since Google compares the two.
    const firefox = firefoxUserAgent(process.platform)
    ses.webRequest.onBeforeSendHeaders({ urls: GOOGLE_SIGN_IN_HOSTS.map((h) => `https://${h}/*`) }, (details, callback) => {
      const headers: Record<string, string> = { ...details.requestHeaders, 'User-Agent': firefox }
      for (const k of Object.keys(headers)) if (/^sec-ch-ua/i.test(k)) delete headers[k]
      callback({ requestHeaders: headers })
    })
    this.adblock.attach(ses)
    ses.registerPreloadScript({ type: 'frame', id: 'solamar-page', filePath: join(__dirname, '../preload/page.js') })
    this.extensions.attach(ses)
    ses.on('will-download', (_e, item) => this.onDownload(item, ses))
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const quiet = ['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'window-management']
      if (quiet.includes(permission)) return callback(true)
      if (!ASKABLE.includes(permission)) return callback(false)
      const site = siteOf(details.requestingUrl || wc?.getURL())
      const known = this.permissionAnswer(site, permission)
      if (known !== undefined) return callback(known)
      const media = (details as { mediaTypes?: string[] }).mediaTypes ?? []
      const detail = permission === 'media' ? (media.includes('video') && media.includes('audio') ? 'camera and microphone' : media.includes('video') ? 'camera' : 'microphone') : undefined
      this.askPermission({ id: uid('perm-'), site, permission, detail }, callback)
    })
    // Lets pages see remembered answers through navigator.permissions.query().
    ses.setPermissionCheckHandler((_wc, permission, origin) => (ASKABLE.includes(permission) ? this.permissionAnswer(siteOf(origin), permission) === true : true))
  }

  // ---------- site permissions (camera, location, notifications...) ----------

  private permQueue: { req: PermissionRequest; callback: (ok: boolean) => void }[] = []
  private sessionPerms = new Map<string, boolean>() // answers that last until Solamar closes

  private permissionAnswer(site: string, permission: string): boolean | undefined {
    const key = `${site}|${permission}`
    const saved = this.doc.settings.sitePermissions[key]
    if (saved) return saved === 'allow'
    return this.sessionPerms.get(key)
  }

  private askPermission(req: PermissionRequest, callback: (ok: boolean) => void): void {
    const same = this.permQueue.find((p) => p.req.site === req.site && p.req.permission === req.permission)
    if (same) {
      const prev = same.callback
      same.callback = (ok) => (prev(ok), callback(ok))
      return
    }
    this.permQueue.push({ req, callback })
    this.showNextPermission()
  }

  private showNextPermission(): void {
    // A notice is no dialog: prompts take the overlay from it, and it comes back afterwards.
    if (!this.permQueue.length || (this.overlayState && this.overlayState.kind !== 'permission' && this.overlayState.kind !== 'notice')) return
    this.openOverlay('permission')
  }

  /** answer: allow / block (remembered for the site) or dismiss (blocked until Solamar closes). */
  decidePermission(id: string, answer: 'allow' | 'block' | 'dismiss'): void {
    const i = this.permQueue.findIndex((p) => p.req.id === id)
    if (i < 0) return
    const [p] = this.permQueue.splice(i, 1)
    const key = `${p.req.site}|${p.req.permission}`
    if (answer === 'dismiss') this.sessionPerms.set(key, false)
    else {
      this.doc.settings.sitePermissions[key] = answer
      this.store.save()
    }
    p.callback(answer === 'allow')
    if (this.permQueue.length) this.openOverlay('permission')
    else if (this.overlayState?.kind === 'permission') this.closeOverlay()
    this.push()
  }

  private ensureView(id: string): WebContentsView {
    const existing = this.views.get(id)
    if (existing) return existing
    const item = this.item(id)!
    const ses = electronSession.fromPartition(this.partitionFor(item))
    this.setupSession(ses)
    // nodeIntegrationInSubFrames only makes the session preloads (src/preload/page.ts) run in iframes as well, so ad
    // blocking scriptlets also reach embedded players and ad frames; with sandbox on, no frame gets Node.
    const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true, spellcheck: true } })
    view.setBorderRadius(RADIUS)
    view.setBackgroundColor('#ffffff')
    this.views.set(id, view)
    this.wcToItem.set(view.webContents.id, id)
    this.runtime[id] = { awake: true, loading: true, canGoBack: false, canGoForward: false, audible: false, blocked: 0, zoom: 1 }
    this.wire(view.webContents, id)
    this.extensions.addTab(view.webContents)
    const saved = this.isPrivate(item.spaceId) ? undefined : this.sessionState.get(id)
    const wc = view.webContents
    const load = (): void => {
      if (!wc.isDestroyed()) wc.loadURL(item.url || 'about:blank').catch(() => {})
    }
    if (saved && saved.entries[saved.index]?.url === item.url)
      // Back/forward history, scroll position and typed form values come back with the tab.
      wc.navigationHistory.restore({ index: saved.index, entries: saved.entries }).catch(load) // the tab may be gone by then
    else load()
    return view
  }

  private wire(wc: WebContents, id: string): void {
    const rt = () => this.runtime[id]
    const nav = () => {
      const r = rt()
      if (!r || wc.isDestroyed()) return
      r.canGoBack = wc.navigationHistory.canGoBack()
      r.canGoForward = wc.navigationHistory.canGoForward()
    }
    wc.on('did-start-loading', () => {
      if (rt()) rt().loading = true
      this.push()
    })
    wc.on('did-stop-loading', () => {
      if (rt()) rt().loading = false
      nav()
      this.push()
    })
    wc.on('page-title-updated', (_e, title) => {
      const it = this.item(id)
      if (!it) return
      if (this.mediaId === id) void this.readMedia(id) // next track
      it.title = title
      const h = this.doc.history.find((x) => x.url === it.url)
      if (h) h.title = title
      this.changed()
    })
    wc.on('page-favicon-updated', (_e, icons) => {
      const it = this.item(id)
      if (it && icons[0] && it.favicon !== icons[0]) {
        it.favicon = icons[0]
        this.changed()
      }
    })
    wc.on('did-navigate', (_e, url) => {
      this.loginNavigated(wc)
      this.adblock.resetCount(wc.id)
      this.onNavigated(id, url, true)
      nav()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.loginNavigated(wc)
      if (isMainFrame) this.onNavigated(id, url, false)
      nav()
    })
    wc.on('dom-ready', () => void this.applyBoosts(wc, true))
    wc.on('audio-state-changed', (e) => {
      if (rt()) rt().audible = e.audible
      if (e.audible) this.setMedia(id)
      this.push()
    })
    wc.on('media-started-playing', () => {
      if (!rt()) return
      rt().playing = true
      if (rt().audible || this.mediaId === id) this.setMedia(id)
      this.push()
    })
    wc.on('media-paused', () => {
      if (rt()) rt().playing = false
      this.push()
    })
    wc.on('render-process-gone', () => {
      if (rt()) rt().crashed = true
      this.push()
    })
    wc.on('enter-html-full-screen', () => {
      this.fullscreenId = id
      this.win.setFullScreen(true)
      this.layout()
    })
    wc.on('leave-html-full-screen', () => {
      this.fullscreenId = null
      this.win.setFullScreen(false)
      this.layout()
    })
    wc.on('before-input-event', (e, input) => this.onKey(e, input))
    wc.on('context-menu', (_e, p) => this.pageMenu(wc, p))
    wc.on('zoom-changed', (_e, dir) => this.zoom(id, dir === 'in' ? 0.1 : -0.1))
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      // Real popups (window.open with features, e.g. sign-in) stay popups so `window.opener` keeps working.
      if (disposition === 'new-window' && features) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 520, height: 680 } }
      // Shift+click on a link asks for a new window: Solamar shows it in Peek instead.
      if (disposition === 'new-window') {
        setImmediate(() => this.openPeek(url, wc))
        return { action: 'deny' }
      }
      this.openTab(url, { after: id, activate: disposition !== 'background-tab' })
      return { action: 'deny' }
    })
  }

  private onNavigated(id: string, url: string, record: boolean): void {
    const it = this.item(id)
    if (!it) return
    it.url = url
    if (record && /^https?:/.test(url) && !this.isPrivate(it.spaceId)) {
      const h = this.doc.history.find((x) => x.url === url)
      if (h) {
        h.visits++
        h.lastVisit = Date.now()
      } else this.doc.history.unshift({ url, title: it.title, lastVisit: Date.now(), visits: 1 })
      if (this.doc.history.length > 5000) this.doc.history.length = 5000
    }
    this.changed()
  }

  private boostKeys = new Map<number, { gen: number; keys: string[] }>() // per page: CSS Solamar inserted for boosts

  /** Puts the site's boosts on a page; CSS is swapped in place for live edits, scripts only run on load. */
  private async applyBoosts(wc: WebContents, runScripts: boolean): Promise<void> {
    if (wc.isDestroyed()) return
    const site = siteOf(wc.getURL())
    const prev = this.boostKeys.get(wc.id)
    const gen = (prev?.gen ?? 0) + 1
    this.boostKeys.set(wc.id, { gen, keys: [] })
    const keys: string[] = []
    for (const b of this.doc.boosts) {
      if (!b.enabled || !boostMatches(b.domain, site)) continue
      const css = boostCss(b)
      if (css) keys.push(await wc.insertCSS(css).catch(() => ''))
      if (runScripts && b.js.trim()) wc.executeJavaScript(`(() => { try {\n${b.js}\n} catch (e) { console.error('[Solamar boost]', e) } })()`).catch(() => {})
    }
    for (const k of prev?.keys ?? []) if (k && !wc.isDestroyed()) wc.removeInsertedCSS(k).catch(() => {})
    if (this.boostKeys.get(wc.id)?.gen === gen) this.boostKeys.set(wc.id, { gen, keys: keys.filter(Boolean) })
    else for (const k of keys) if (k && !wc.isDestroyed()) wc.removeInsertedCSS(k).catch(() => {}) // a newer pass won
  }

  /** Re-applies boost CSS on every open page after an edit. */
  private liveBoosts(): void {
    for (const v of [...this.views.values(), this.peekView]) if (v && !v.webContents.isDestroyed()) void this.applyBoosts(v.webContents, false)
  }

  // ---------- boost editor ----------

  boostEditor: BoostEditorState | null = null
  private zapToken = 0

  /** Opens the editor for the active tab's site, creating an empty boost for it. */
  openBoost(): void {
    const it = this.item(this.activeId())
    const site = siteOf(it?.url)
    if (!it?.url || !/^https?:/.test(it.url) || !site) return
    let b = this.doc.boosts.find((x) => x.domain === site) ?? this.doc.boosts.find((x) => boostMatches(x.domain, site))
    if (!b) {
      b = { id: uid('b-'), domain: site, css: '', js: '', enabled: true, zaps: [], font: '', filter: 'none', hue: 0 }
      this.doc.boosts.push(b)
    }
    const id = b.id
    if (this.boostEditor?.id === id) return
    void this.animateLayout(() => {
      this.ai.panelOpen = false
      this.boostEditor = { id, zapping: false }
    })
  }

  closeBoost(): void {
    const ed = this.boostEditor
    if (!ed) return
    this.stopZap()
    const b = this.doc.boosts.find((x) => x.id === ed.id)
    if (b && isEmptyBoost(b)) this.doc.boosts = this.doc.boosts.filter((x) => x !== b)
    this.store.save()
    void this.animateLayout(() => (this.boostEditor = null))
  }

  updateBoost(id: string, patch: Partial<Omit<Boost, 'id'>>): void {
    const b = this.doc.boosts.find((x) => x.id === id)
    if (!b) return
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (b as unknown as Record<string, unknown>)[k] = v
    this.liveBoosts()
    this.changed()
  }

  deleteBoost(id: string): void {
    if (this.boostEditor?.id === id) {
      this.stopZap()
      void this.animateLayout(() => (this.boostEditor = null))
    }
    this.doc.boosts = this.doc.boosts.filter((x) => x.id !== id)
    this.liveBoosts()
    this.changed()
  }

  /** The file of the icon picked in Settings > Appearance. Packaged builds unpack build/icons so Windows can read them. */
  private appIconPath(ext: 'ico' | 'png'): string {
    const id = this.doc.settings.appIcon
    const file = id && id !== 'violet' ? join(ROOT, 'build', 'icons', `${id}.${ext}`) : join(ROOT, 'build', `icon.${ext}`) // violet is build/icon
    const real = file.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
    return existsSync(real) ? real : join(ROOT, 'build', `icon.${ext}`)
  }

  /** Puts the picked icon on the window and its taskbar button (Windows reads the button's icon from the app details). */
  applyAppIcon(): void {
    if (!this.win || this.win.isDestroyed()) return
    // macOS shows the app's icon in the Dock; its windows have none (setIcon does not exist there).
    if (MAC) return void app.dock?.setIcon(this.appIconPath('png'))
    this.win.setIcon(this.appIconPath(process.platform === 'win32' ? 'ico' : 'png'))
    if (process.platform !== 'win32') return
    // The taskbar groups by app id and draws the icon of what that id points at. A dev build's process id is
    // electron.exe, so the button would show Electron's logo; a window id with its own relaunch icon shows Solamar's.
    const exe = process.execPath
    this.win.setAppDetails({
      appId: app.isPackaged ? 'app.solamar.browser' : 'app.solamar.browser.dev',
      appIconPath: this.appIconPath('ico'),
      relaunchCommand: app.isPackaged ? `"${exe}"` : `"${exe}" "${ROOT}"`,
      relaunchDisplayName: 'Solamar'
    })
  }

  /** Zap mode: each click on the page hides that element for good, until Escape or Stop. */
  async startZap(): Promise<void> {
    const ed = this.boostEditor
    const a = this.activeId()
    const wc = a ? this.views.get(a)?.webContents : undefined
    const b = this.doc.boosts.find((x) => x.id === ed?.id)
    if (!ed || !b || !wc || wc.isDestroyed() || !boostMatches(b.domain, siteOf(wc.getURL()))) return
    const token = ++this.zapToken
    ed.zapping = true
    this.push()
    wc.focus()
    try {
      while (this.zapToken === token && this.boostEditor?.zapping) {
        const r = (await wc.executeJavaScriptInIsolatedWorld(BOOST_WORLD, [{ code: zapJs }], true).catch(() => null)) as { selector?: unknown; stop?: boolean } | null
        if (this.zapToken !== token || !r || r.stop || typeof r.selector !== 'string') break
        const sel = r.selector.slice(0, 500)
        if (sel && !b.zaps.includes(sel)) b.zaps.push(sel)
        b.enabled = true
        this.liveBoosts()
        this.changed()
      }
    } finally {
      if (this.zapToken === token && this.boostEditor) this.boostEditor.zapping = false
      this.push()
    }
  }

  stopZap(): void {
    this.zapToken++
    if (this.boostEditor) this.boostEditor.zapping = false
    for (const v of this.views.values()) if (!v.webContents.isDestroyed()) v.webContents.executeJavaScriptInIsolatedWorld(BOOST_WORLD, [{ code: zapStopJs }]).catch(() => {})
    this.push()
  }

  // ---------- mini player ----------

  private mediaId: string | null = null // tab behind the mini player
  private mediaInfo = { title: '', artist: '', video: false }
  private pipIds = new Set<string>() // tabs Solamar popped into Picture-in-Picture

  private setMedia(id: string): void {
    if (this.mediaId !== id) {
      this.mediaId = id
      this.mediaInfo = { title: '', artist: '', video: false }
    }
    void this.readMedia(id)
  }

  private async readMedia(id: string): Promise<void> {
    const wc = this.views.get(id)?.webContents
    if (!wc || wc.isDestroyed()) return
    const info = (await wc.executeJavaScript(mediaJs('info')).catch(() => null)) as { title?: unknown; artist?: unknown; video?: unknown } | null
    if (!info || this.mediaId !== id) return
    const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '')
    this.mediaInfo = { title: text(info.title), artist: text(info.artist), video: !!info.video }
    this.push()
  }

  /** The mini player shows while media from a tab you are not looking at plays (or was paused from the player). */
  private mediaState(): MediaState | null {
    const id = this.mediaId
    const it = this.item(id)
    const rt = id ? this.runtime[id] : undefined
    const wc = id ? this.views.get(id)?.webContents : undefined
    if (!id || !it || !rt || !wc || wc.isDestroyed() || this.visibleIds().includes(id)) return null
    return {
      id,
      title: this.mediaInfo.title || it.customTitle || it.title || hostOf(it.url),
      artist: this.mediaInfo.artist,
      site: hostOf(it.url),
      playing: !!rt.playing,
      video: this.mediaInfo.video,
      muted: wc.isAudioMuted()
    }
  }

  async mediaAction(action: 'toggle' | 'pip' | 'mute' | 'close'): Promise<void> {
    const id = this.mediaId
    const wc = id ? this.views.get(id)?.webContents : undefined
    if (!id || !wc || wc.isDestroyed()) return
    if (action === 'mute') wc.setAudioMuted(!wc.isAudioMuted())
    else if (action === 'close') {
      await wc.executeJavaScript(mediaJs('pause'), true).catch(() => {})
      await wc.executeJavaScript(mediaJs('pipExit'), true).catch(() => {})
      this.mediaId = null
    } else {
      const ok = await wc.executeJavaScript(mediaJs(action), true).catch(() => false)
      // Sound from something Solamar cannot reach (Web Audio, an Audio object outside the page): mute instead.
      if (!ok && action === 'toggle') wc.setAudioMuted(!wc.isAudioMuted())
    }
    this.push()
  }

  /** Called with the tabs that were on screen before a switch: pops playing videos out, brings them back in. */
  private mediaOnSwitch(before: string[]): void {
    const now = this.visibleIds()
    for (const id of before) {
      if (now.includes(id)) continue
      const rt = this.runtime[id]
      const wc = this.views.get(id)?.webContents
      if (!this.doc.settings.autoPip || !rt?.playing || !rt.audible || !wc || wc.isDestroyed()) continue
      this.pipIds.add(id)
      wc.executeJavaScript(mediaJs('pipEnter'), true).catch(() => {})
    }
    for (const id of now) {
      if (this.pipIds.delete(id)) this.views.get(id)?.webContents.executeJavaScript(mediaJs('pipExit'), true).catch(() => {})
      if (this.mediaId === id && !this.runtime[id]?.playing) this.mediaId = null // seen and stopped: no player next time
    }
  }

  // ---------- peek ----------

  peek: Omit<PeekState, 'rect'> | null = null
  private peekView: WebContentsView | null = null
  private peekSpaceId: string | null = null

  private peekRect(): Bounds {
    const r = this.contentRect()
    const width = Math.round(Math.max(200, Math.min(r.width - 56, 1180)))
    return { x: Math.round(r.x + (r.width - width) / 2), y: r.y + 52, width, height: Math.max(120, r.height - 52 - 20) }
  }

  /** Shows a link over the current page, in the same profile; Escape or a click outside closes it. */
  openPeek(url: string, from?: WebContents): void {
    if (!/^https?:/i.test(url)) return
    const fromItem = this.item((from && this.wcToItem.get(from.id)) || this.activeId())
    this.dropPeek()
    const ses = electronSession.fromPartition(fromItem ? this.partitionFor(fromItem) : this.doc.profiles[0].partition)
    this.setupSession(ses)
    // Same as tab views: page preload (ad block scriptlets) in iframes too, see ensureView.
    const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true, spellcheck: true } })
    view.setBorderRadius(RADIUS)
    view.setBackgroundColor('#ffffff')
    this.peekView = view
    this.peekSpaceId = fromItem?.spaceId ?? this.doc.window.focusedSpaceId
    this.peek = { url, title: hostOf(url), loading: true }
    const wc = view.webContents
    const mine = () => this.peekView === view && !!this.peek
    const update = (patch: Partial<Omit<PeekState, 'rect'>>) => {
      if (!mine()) return
      Object.assign(this.peek!, patch)
      this.push()
    }
    wc.on('page-title-updated', (_e, title) => update({ title }))
    wc.on('did-navigate', (_e, u) => update({ url: u }))
    wc.on('did-navigate-in-page', (_e, u, main) => main && update({ url: u }))
    wc.on('did-start-loading', () => update({ loading: true }))
    wc.on('did-stop-loading', () => update({ loading: false }))
    wc.on('dom-ready', () => mine() && void this.applyBoosts(wc, true))
    wc.on('before-input-event', (e, input) => mine() && this.onKey(e, input))
    wc.on('context-menu', (_e, p) => mine() && this.pageMenu(wc, p))
    wc.setWindowOpenHandler(({ url: u, disposition, features }) => {
      if (disposition === 'new-window' && features) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 520, height: 680 } }
      if (mine())
        setImmediate(() => {
          this.closeOverlay()
          this.openTab(u, { activate: disposition !== 'background-tab' })
        })
      return { action: 'deny' }
    })
    wc.loadURL(url).catch(() => {})
    this.openOverlay('peek')
  }

  /** Peek becomes a real tab (or the other half of a split) with its page, history and scroll kept. */
  promotePeek(split = false): void {
    const v = this.peekView
    const p = this.peek
    if (!v || !p || v.webContents.isDestroyed()) return
    this.peekView = null
    this.peek = null
    this.win.contentView.removeChildView(v)
    const from = this.activeId()
    const spaceId = this.peekSpaceId && this.doc.spaces.some((s) => s.id === this.peekSpaceId) ? this.peekSpaceId : this.doc.window.focusedSpaceId
    const id = this.openTab(p.url, { activate: false, after: from ?? undefined, spaceId })
    const wc = v.webContents
    const it = this.item(id)!
    it.title = wc.getTitle() || it.title
    this.views.set(id, v)
    this.wcToItem.set(wc.id, id)
    this.runtime[id] = {
      awake: true,
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      audible: wc.isCurrentlyAudible(),
      blocked: 0,
      zoom: 1
    }
    this.wire(wc, id)
    this.extensions.addTab(wc)
    this.closeOverlay()
    if (split && from && spaceId === this.doc.window.focusedSpaceId) this.splitWith(id)
    else this.activate(id)
  }

  private dropPeek(): void {
    const v = this.peekView
    this.peekView = null
    this.peek = null
    if (!v) return
    this.win.contentView.removeChildView(v)
    if (!v.webContents.isDestroyed()) v.webContents.close()
  }

  /** From the page preload: a plain click on a link to another site in a pinned tab or favorite. */
  peekLink(sender: WebContents, url: string): boolean {
    if (!this.doc.settings.peekFromPinned || !/^https?:/i.test(url)) return false
    const it = this.item(this.wcToItem.get(sender.id))
    if (!it || (it.section !== 'pinned' && it.section !== 'favorites')) return false
    this.openPeek(url, sender)
    return true
  }

  private siblings(spaceId: string | null, section: Section, parentId: string | null): Item[] {
    return this.doc.items
      .filter((i) => i.section === section && i.parentId === parentId && (section === 'favorites' || i.spaceId === spaceId))
      .sort((a, b) => a.position - b.position)
  }

  openTab(url: string, opts: { after?: string; activate?: boolean; section?: Section; spaceId?: string } = {}): string {
    const spaceId = opts.spaceId ?? this.doc.window.focusedSpaceId
    const section = opts.section ?? 'today'
    const now = Date.now()
    const item: Item = { id: uid('i-'), spaceId, parentId: null, kind: 'tab', section, url, title: hostOf(url), position: 0, createdAt: now, lastActiveAt: now }
    // New today tabs go to the top of the list (or right under the tab that opened them).
    const list = this.siblings(spaceId, section, null)
    const at = opts.after ? list.findIndex((i) => i.id === opts.after) + 1 : 0
    list.splice(Math.max(0, at), 0, item)
    list.forEach((it, i) => (it.position = i))
    this.doc.items.push(item)
    if (opts.activate !== false) this.activate(item.id)
    else this.changed()
    return item.id
  }

  activate(id: string): void {
    const it = this.item(id)
    if (!it) return
    if (it.kind === 'folder') return this.toggleFolder(id)
    const before = this.visibleIds()
    if (this.boostEditor?.zapping && before[0] !== id) this.stopZap()
    if (it.spaceId && it.spaceId !== this.doc.window.focusedSpaceId) this.doc.window.focusedSpaceId = it.spaceId
    this.doc.window.activeBySpace[this.doc.window.focusedSpaceId] = id
    it.lastActiveAt = Date.now()
    // Expand folders above the tab so it is visible in the sidebar.
    for (let p = this.item(it.parentId); p; p = this.item(p.parentId)) p.collapsed = false
    this.ensureView(id)
    if (this.runtime[id]?.crashed) {
      this.runtime[id].crashed = false
      this.views.get(id)?.webContents.reload()
    }
    this.mediaOnSwitch(before)
    this.layout()
    const view = this.views.get(id)
    if (view) this.extensions.selectTab(view.webContents)
    if (!this.overlayState) view?.webContents.focus()
    this.changed()
  }

  private nextActiveAfterClose(it: Item): string | null {
    const list = this.flatTabs()
    const i = list.findIndex((x) => x.id === it.id)
    const rest = list.filter((x) => x.id !== it.id)
    return rest[Math.min(Math.max(0, i), rest.length - 1)]?.id ?? null
  }

  /** Tabs of the focused space in sidebar order (favorites, pinned, today; folders expanded). */
  private flatTabs(): Item[] {
    const out: Item[] = []
    const visit = (spaceId: string | null, section: Section, parent: string | null) => {
      for (const it of this.siblings(spaceId, section, parent)) {
        if (it.kind === 'tab') out.push(it)
        else visit(spaceId, section, it.id)
      }
    }
    visit(null, 'favorites', null)
    visit(this.doc.window.focusedSpaceId, 'pinned', null)
    visit(this.doc.window.focusedSpaceId, 'today', null)
    return out
  }

  closeTab(id: string | null): void {
    const it = this.item(id)
    if (!it || it.kind !== 'tab') return
    const wasActive = this.activeId() === it.id
    const next = wasActive ? this.nextActiveAfterClose(it) : null
    if (it.section === 'today') {
      if (it.url) this.closed.push({ url: it.url, title: it.title, spaceId: it.spaceId })
      if (this.closed.length > 50) this.closed.shift()
      this.removeItems([it.id])
    } else {
      // Pinned tabs and favorites stay in the sidebar; closing just unloads them.
      this.sleep(it.id)
    }
    if (wasActive) {
      this.doc.window.activeBySpace[this.doc.window.focusedSpaceId] = null
      if (next && next !== it.id) this.activate(next)
    }
    this.layout()
    this.changed()
  }

  private removeItems(ids: string[]): void {
    const all = new Set<string>()
    const add = (id: string) => {
      all.add(id)
      for (const c of this.doc.items) if (c.parentId === id) add(c.id)
    }
    ids.forEach(add)
    for (const id of all) this.sleep(id)
    for (const id of all) this.sessionState.forget(id)
    this.doc.items = this.doc.items.filter((i) => !all.has(i.id))
    this.doc.window.split = this.doc.window.split.filter((id) => !all.has(id))
    for (const [s, a] of Object.entries(this.doc.window.activeBySpace)) if (a && all.has(a)) this.doc.window.activeBySpace[s] = null
  }

  /** Remembers a tab's back/forward entries and page state (not for private spaces). */
  private rememberSession(id: string): void {
    const wc = this.views.get(id)?.webContents
    const it = this.item(id)
    if (!wc || wc.isDestroyed() || !it || this.isPrivate(it.spaceId)) return
    const entries = wc.navigationHistory.getAllEntries()
    if (entries.length) this.sessionState.set(id, { index: wc.navigationHistory.getActiveIndex(), entries })
  }

  /** Saves every awake tab's session; also called on a timer so a crash loses at most a few seconds. */
  saveSessions(final = false): void {
    for (const id of this.views.keys()) this.rememberSession(id)
    const live = new Set(this.doc.items.filter((i) => i.kind === 'tab' && !this.isPrivate(i.spaceId)).map((i) => i.id))
    if (final) this.sessionState.close(live)
    else this.sessionState.save(live)
  }

  dismissCrashNotice(): void {
    this.restoredAfterCrash = false
    this.push()
  }

  sleep(id: string): void {
    const v = this.views.get(id)
    if (!v) return
    this.rememberSession(id)
    if (this.attached.has(v)) {
      this.win.contentView.removeChildView(v)
      this.attached.delete(v)
    }
    this.wcToItem.delete(v.webContents.id)
    this.adblock.resetCount(v.webContents.id)
    v.webContents.close()
    this.views.delete(id)
    delete this.runtime[id]
  }

  private housekeeping(): void {
    const s = this.doc.settings
    const visible = new Set(this.visibleIds())
    const now = Date.now()
    for (const id of tabsToSleep(this.doc.items, this.runtime, visible, now, s.sleepAfterMinutes)) this.sleep(id)
    // Private tabs are never archived (the archive is saved); they stay until the space is closed.
    const toArchive = tabsToArchive(this.doc.items.filter((i) => !this.isPrivate(i.spaceId)), visible, now, s.archiveAfterHours, this.runtime)
    for (const id of toArchive) {
      const it = this.item(id)!
      if (it.url) this.doc.archive.unshift({ id: uid('a-'), spaceId: it.spaceId, title: it.title, url: it.url, favicon: it.favicon, archivedAt: now })
    }
    if (toArchive.length) {
      this.removeItems(toArchive)
      if (this.doc.archive.length > 1000) this.doc.archive.length = 1000
      this.changed()
    } else this.push()
  }

  restoreArchived(archiveId: string): void {
    const a = this.doc.archive.find((x) => x.id === archiveId)
    if (!a) return
    this.doc.archive = this.doc.archive.filter((x) => x.id !== archiveId)
    this.closeOverlay()
    this.openTab(a.url, { spaceId: a.spaceId && this.doc.spaces.some((s) => s.id === a.spaceId) ? a.spaceId : undefined })
  }

  listArchive(query: string) {
    const q = query.toLowerCase()
    return this.doc.archive.filter((a) => !q || (a.title ?? '').toLowerCase().includes(q) || a.url.toLowerCase().includes(q)).slice(0, 200)
  }

  // ---------- sidebar organisation ----------

  moveItem(id: string, to: { section: Section; parentId: string | null; index: number; spaceId?: string }): void {
    const it = this.item(id)
    if (!it) return
    // A folder cannot go inside itself; favorites hold tabs only.
    for (let p = this.item(to.parentId); p; p = this.item(p.parentId)) if (p.id === id) return
    if (to.section === 'favorites' && it.kind === 'folder') return
    const spaceId = to.section === 'favorites' ? null : (to.spaceId ?? it.spaceId ?? this.doc.window.focusedSpaceId)
    const oldList = this.siblings(it.spaceId, it.section, it.parentId).filter((x) => x.id !== id)
    oldList.forEach((x, i) => (x.position = i))
    const moveTree = (node: Item) => {
      node.spaceId = spaceId
      node.section = to.section
      for (const c of this.doc.items) if (c.parentId === node.id) moveTree(c)
    }
    moveTree(it)
    it.parentId = to.parentId
    const list = this.siblings(spaceId, to.section, to.parentId).filter((x) => x.id !== id)
    list.splice(Math.max(0, Math.min(to.index, list.length)), 0, it)
    list.forEach((x, i) => (x.position = i))
    it.lastActiveAt = Date.now()
    this.changed()
  }

  togglePin(id: string | null): void {
    const it = this.item(id)
    if (!it) return
    const target: Section = it.section === 'today' ? 'pinned' : 'today'
    this.moveItem(it.id, { section: target, parentId: null, index: target === 'pinned' ? this.siblings(it.spaceId, 'pinned', null).length : 0 })
  }

  createFolder(section: Section = 'pinned', parentId: string | null = null, title = 'New folder'): string {
    const spaceId = this.doc.window.focusedSpaceId
    const now = Date.now()
    const list = this.siblings(spaceId, section, parentId)
    const item: Item = { id: uid('i-'), spaceId, parentId, kind: 'folder', section, title, position: list.length, createdAt: now, lastActiveAt: now }
    this.doc.items.push(item)
    this.changed()
    return item.id
  }

  rename(id: string, title: string): void {
    const it = this.item(id)
    if (!it) return
    const t = title.trim().slice(0, 120)
    if (it.kind === 'folder') it.title = t || it.title
    else it.customTitle = t || undefined
    this.changed()
  }

  toggleFolder(id: string): void {
    const it = this.item(id)
    if (it?.kind !== 'folder') return
    it.collapsed = !it.collapsed
    this.changed()
  }

  deleteItem(id: string): void {
    const it = this.item(id)
    if (!it) return
    const wasActive = this.activeId() === id
    this.removeItems([id])
    if (wasActive) {
      const next = this.flatTabs()[0]
      if (next) this.activate(next.id)
    }
    this.layout()
    this.changed()
  }

  duplicate(id: string): void {
    const it = this.item(id)
    if (it?.url) this.openTab(it.url, { after: it.section === 'today' ? id : undefined })
  }

  // ---------- spaces ----------

  switchSpace(id: string): void {
    if (!this.doc.spaces.some((s) => s.id === id)) return
    const before = this.visibleIds()
    this.doc.window.focusedSpaceId = id
    const a = this.activeId()
    if (a) this.item(a)!.lastActiveAt = Date.now()
    this.mediaOnSwitch(before)
    this.layout()
    this.focusContent()
    this.changed()
  }

  cycleSpace(dir: 1 | -1): void {
    const list = [...this.doc.spaces].sort((a, b) => a.position - b.position)
    const i = list.findIndex((s) => s.id === this.doc.window.focusedSpaceId)
    this.switchSpace(list[(i + dir + list.length) % list.length].id)
  }

  createSpace(input: { title: string; icon: string; theme: SpaceTheme; profileId?: string }): string {
    const id = uid('s-')
    const position = Math.max(-1, ...this.doc.spaces.map((s) => s.position)) + 1
    this.doc.spaces.push({
      id,
      profileId: input.profileId && this.doc.profiles.some((p) => p.id === input.profileId) ? input.profileId : this.doc.profiles[0].id,
      title: input.title.trim().slice(0, 40) || 'Space',
      icon: input.icon,
      theme: input.theme,
      position
    })
    this.switchSpace(id)
    return id
  }

  updateSpace(id: string, patch: Partial<Pick<Space, 'title' | 'icon' | 'theme' | 'profileId'>>): void {
    const s = this.doc.spaces.find((x) => x.id === id)
    if (!s) return
    if (patch.title !== undefined) s.title = patch.title.trim().slice(0, 40) || s.title
    if (patch.icon) s.icon = patch.icon
    if (patch.theme) s.theme = patch.theme
    if (patch.profileId && this.doc.profiles.some((p) => p.id === patch.profileId) && patch.profileId !== s.profileId) {
      s.profileId = patch.profileId
      for (const it of this.doc.items) if (it.spaceId === id) this.sleep(it.id) // reload in the new cookie jar
      this.layout()
    }
    this.changed()
  }

  async deleteSpace(id: string): Promise<void> {
    if (this.doc.spaces.length <= 1) return
    const s = this.doc.spaces.find((x) => x.id === id)
    if (!s) return
    const { response } = s.private ? { response: 0 } : await dialog.showMessageBox(this.win, {
      type: 'warning',
      buttons: ['Delete space', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Delete the space "${s.title}"?`,
      detail: 'Its pinned and today tabs are removed. This cannot be undone.'
    })
    if (response !== 0) return
    this.removeItems(this.doc.items.filter((i) => i.spaceId === id).map((i) => i.id))
    this.doc.spaces = this.doc.spaces.filter((x) => x.id !== id)
    const prof = this.doc.profiles.find((p) => p.id === s.profileId && p.ephemeral)
    if (prof) {
      void electronSession.fromPartition(prof.partition).clearStorageData()
      this.doc.profiles = this.doc.profiles.filter((p) => p !== prof)
    }
    delete this.doc.window.activeBySpace[id]
    if (this.doc.window.focusedSpaceId === id) this.doc.window.focusedSpaceId = this.doc.spaces[0].id
    this.layout()
    this.changed()
  }

  // ---------- split view ----------

  splitWith(id: string): void {
    const a = this.activeId()
    if (!a || a === id || !this.item(id)) return
    this.doc.window.split = [a, id]
    this.ensureView(id)
    this.layout()
    this.changed()
  }

  unsplit(): void {
    this.doc.window.split = []
    this.layout()
    this.changed()
  }

  // ---------- overlay ----------

  openOverlay(kind: OverlayKind, payload?: OverlayState['payload']): void {
    if (this.overlayState?.kind === 'peek' && kind !== 'peek') this.dropPeek()
    if (this.overlayState?.kind === 'extension-install' && kind !== 'extension-install' && this.extensionAnswer) {
      this.extensionAnswer(false) // another dialog took its place: the store gets a cancel, not a hang
      this.extensionAnswer = null
      this.extensionInstall = null
    }
    this.overlayState = { kind, payload }
    this.layout()
    // A notice is only a message: the page keeps the keyboard.
    if (kind !== 'notice') (kind === 'peek' && this.peekView ? this.peekView : this.overlay).webContents.focus()
    this.push()
  }

  closeOverlay(): void {
    if (!this.overlayState) return
    const wasPermission = this.overlayState.kind === 'permission'
    if (this.overlayState.kind === 'write') {
      this.writeAbort?.abort()
      this.write = null
      this.writeTarget = null
    }
    if (this.overlayState.kind === 'command') {
      this.answerAbort?.abort()
      this.answer = null
    }
    if (this.overlayState.kind === 'peek') this.dropPeek()
    if (this.overlayState.kind === 'extension-install' && this.extensionAnswer) {
      this.extensionAnswer(false)
      this.extensionAnswer = null
      this.extensionInstall = null
    }
    if (this.overlayState.kind === 'vault-unlock') {
      const waiters = this.unlockWaiters
      this.unlockWaiters = []
      waiters.forEach((w) => w(!this.vault.locked))
    }
    this.overlayState = null
    this.win.contentView.removeChildView(this.overlay)
    this.focusContent()
    this.push()
    // A prompt that waited behind another dialog shows up now; so does a notice that was showing inside it.
    if (!wasPermission) this.showNextPermission()
    if (!this.overlayState && this.notice) this.openOverlay('notice')
    if (!this.overlayState && this.savePrompt && !this.savePrompt.shown) this.showSavePrompt()
  }

  /** Live sidebar resize while the user drags its edge (the overlay captures the mouse over web pages). */
  setSidebarWidth(width: number): void {
    const w = Math.max(200, Math.min(420, Math.round(width)))
    if (w === this.doc.settings.sidebarWidth) return
    this.doc.settings.sidebarWidth = w
    this.layout()
    this.changed()
  }

  // ---------- passwords (save after a login, fill on request) ----------

  private pendingLogins = new Map<number, { origin: string; username: string; password: string; at: number }>()
  private savePrompt: { prompt: SavePasswordPrompt; origin: string; username: string; password: string; shown: boolean } | null = null

  /** Pages in tabs or Peek (not Solamar's own UI, not popups). */
  private isPage(wc: WebContents): boolean {
    return this.wcToItem.has(wc.id) || this.peekView?.webContents === wc
  }

  private pagePrivate(wc: WebContents): boolean {
    const id = this.wcToItem.get(wc.id)
    return id ? this.isPrivate(this.item(id)?.spaceId) : this.isPrivate(this.peekSpaceId)
  }

  /** A login form was sent. Nothing is shown yet: the page has to move on first (navigation or the form going away). */
  loginSubmitted(wc: WebContents, frameUrl: string, username: string, password: string): void {
    const origin = originOf(frameUrl)
    const p = this.doc.settings.passwords
    if (!origin || !password || !this.vault.available || !p.offer || !this.isPage(wc) || this.pagePrivate(wc)) return
    if (p.never.includes(siteOf(origin))) return
    const known = this.vault.check(origin, username, password)
    if (known === 'same' || known === 'locked') return // locked: a login it has, most likely with this password
    this.pendingLogins.set(wc.id, { origin, username, password, at: Date.now() })
  }

  loginDone(wc: WebContents): void {
    this.offerSave(wc)
  }

  private loginNavigated(wc: WebContents): void {
    // The page that answers the login form: the earliest sign the login went through.
    setTimeout(() => this.offerSave(wc), 600)
  }

  private offerSave(wc: WebContents): void {
    const p = this.pendingLogins.get(wc.id)
    if (!p) return
    this.pendingLogins.delete(wc.id)
    if (Date.now() - p.at > 30_000 || this.doc.settings.passwords.never.includes(siteOf(p.origin))) return
    const kind = this.vault.check(p.origin, p.username, p.password)
    if (kind === 'same' || kind === 'locked') return
    this.savePrompt = {
      prompt: { id: uid('sp-'), site: hostOf(p.origin), username: p.username, update: kind === 'update', locked: this.vault.locked },
      origin: p.origin,
      username: p.username,
      password: p.password,
      shown: false
    }
    this.showSavePrompt()
  }

  private showSavePrompt(): void {
    if (!this.savePrompt) return
    // Waits behind any other dialog or prompt.
    if (this.overlayState && this.overlayState.kind !== 'save-password' && this.overlayState.kind !== 'notice') return this.push()
    this.savePrompt.shown = true
    this.openOverlay('save-password')
    this.focusContent()
    const a = this.activeId()
    this.views.get(a ?? '')?.webContents.focus() // the card does not take the keyboard from the page
  }

  async decideSavePassword(answer: 'save' | 'never' | 'dismiss'): Promise<void> {
    const sp = this.savePrompt
    this.savePrompt = null
    if (this.overlayState?.kind === 'save-password') this.closeOverlay()
    if (!sp) return
    if (answer === 'save' && (await this.requestUnlock(hostOf(sp.origin), 'save'))) await this.vault.save(sp.origin, sp.username, sp.password).catch(() => {})
    if (answer === 'never') {
      const site = siteOf(sp.origin)
      if (!this.doc.settings.passwords.never.includes(site)) this.doc.settings.passwords.never.push(site)
      this.store.save()
    }
    this.push()
  }

  /** Usernames saved for the asking frame's origin (no passwords). */
  loginsFor(wc: WebContents, frameUrl: string): { id: string; username: string }[] {
    const origin = originOf(frameUrl)
    if (!origin || !this.isPage(wc)) return []
    return this.vault.forOrigin(origin).map((l) => ({ id: l.id, username: l.username }))
  }

  /** The login the user picked in the page's list; only for the origin it was saved on. Asks for the master password first
   * when the vault is locked. */
  async loginFill(wc: WebContents, frameUrl: string, id: string): Promise<{ username: string; password: string } | null> {
    const meta = this.vault.info(id)
    if (!meta || !this.isPage(wc) || originOf(frameUrl) !== meta.origin) return null
    if (!(await this.requestUnlock(hostOf(meta.origin), 'fill'))) return null
    const l = this.vault.get(id)
    if (!l || wc.isDestroyed() || originOf(frameUrl) !== l.origin) return null
    this.vault.markUsed(id)
    this.vaultUsed()
    return { username: l.username, password: l.password }
  }

  // ---------- vault protection: master password, auto-lock, confirming it is you ----------

  osAuth: OsAuthKind = 'none'
  private verifiedUntil = 0 // a confirmation covers the next minute, so showing three passwords asks once
  private lastVaultUse = Date.now()
  private unlockWaiters: ((ok: boolean) => void)[] = []

  private setupVaultProtection(): void {
    void osAuthKind().then((k) => {
      this.osAuth = k
      this.push()
    })
    const lockNow = () => this.vaultLock()
    powerMonitor.on('lock-screen', lockNow)
    powerMonitor.on('suspend', lockNow)
    setInterval(() => {
      const after = this.doc.settings.passwords.lockAfter
      if (this.vault.hasMaster && !this.vault.locked && after > 0 && Date.now() - this.lastVaultUse > after * 60_000) this.vaultLock()
    }, 30_000).unref()
  }

  private vaultUsed(): void {
    this.lastVaultUse = Date.now()
  }

  vaultLock(): void {
    if (!this.vault.hasMaster || this.vault.locked) return
    this.vault.lock()
    this.verifiedUntil = 0
    this.push()
  }

  /** The master password typed in the unlock card or in Settings. A right one also counts as "it is you" for a minute. */
  async vaultUnlock(password: string): Promise<boolean> {
    const ok = await this.vault.unlock(password)
    if (ok) {
      this.vaultUsed()
      this.verifiedUntil = Date.now() + 60_000
      const waiters = this.unlockWaiters
      this.unlockWaiters = []
      waiters.forEach((w) => w(true))
      if (this.overlayState?.kind === 'vault-unlock') this.closeOverlay()
    }
    this.push()
    return ok
  }

  /** Resolves once the vault is unlocked: right away, or after the user types the master password in the unlock card. */
  private requestUnlock(site: string, why: 'fill' | 'save'): Promise<boolean> {
    if (!this.vault.locked) return Promise.resolve(true)
    const busy = this.overlayState && !['notice', 'save-password', 'vault-unlock'].includes(this.overlayState.kind)
    if (busy) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.unlockWaiters.push(resolve)
      if (this.overlayState?.kind !== 'vault-unlock') this.openOverlay('vault-unlock', { text: site, mode: why === 'save' ? 'new' : 'edit' })
    })
  }

  /** Before a password is shown or copied: Windows Hello / Touch ID, or the master password where neither is set up. */
  async confirmOwner(reason: string, master?: string): Promise<'ok' | 'denied' | 'need-master'> {
    if (Date.now() < this.verifiedUntil) return 'ok'
    if (master && this.vault.hasMaster) {
      if (!(await this.vault.verifyMaster(master))) return 'denied'
      this.verifiedUntil = Date.now() + 60_000
      this.push()
      return 'ok'
    }
    const r = await osVerify(reason, this.win.getNativeWindowHandle())
    if (r === 'verified') {
      this.verifiedUntil = Date.now() + 60_000
      return 'ok'
    }
    if (r === 'canceled') return 'denied'
    // Nothing to confirm with: the master password if there is one, otherwise as before (Settings says how to add one).
    return this.vault.hasMaster ? 'need-master' : 'ok'
  }

  /** A saved password for Settings (Show, Copy): only after confirming it is you, and with the vault unlocked. */
  async revealPassword(id: string, master?: string): Promise<{ password: string } | { error: 'locked' | 'denied' | 'need-master' | 'missing' }> {
    if (this.vault.locked) {
      if (!master || !(await this.vaultUnlock(master))) return { error: 'locked' }
    }
    const c = await this.confirmOwner('Solamar wants to show a saved password', master)
    if (c !== 'ok') return { error: c }
    try {
      const l = this.vault.get(id)
      if (!l) return { error: 'missing' }
      this.vaultUsed()
      return { password: l.password }
    } catch (err) {
      if (err instanceof VaultLockedError) return { error: 'locked' }
      throw err
    }
  }

  // ---------- page agent (Solamar's own, on the current tab) ----------

  pageAgent: PageAgentState | null = null // with the earlier turns of its conversation
  private pageAgentAbort: AbortController | null = null

  async agentRun(task: string): Promise<void> {
    if (!task.trim()) return
    const id = this.activeId()
    const it = this.item(id)
    const wc = id ? this.views.get(id)?.webContents : undefined
    // A follow-up continues the conversation; "New conversation" (agentClear) starts a fresh one.
    const prev = this.pageAgent
    const earlier: PageAgentTurn[] = prev
      ? [...prev.earlier, { task: prev.task, url: prev.url, since: prev.since, until: prev.until ?? Date.now(), text: prev.text, error: prev.error }].slice(-MAX_AGENT_TURNS)
      : []
    const fail = (error: string) => {
      this.pageAgent = { task, tabId: id ?? '', url: wc?.getURL() ?? '', since: Date.now(), running: false, text: '', error, earlier }
      this.push()
    }
    if (!this.doc.settings.ai.enabled) return fail('Turn on AI in Settings > AI first.')
    if (!id || !it || !wc || !/^https?:/.test(wc.getURL())) return fail('Open a web page first; the agent works on the tab you are looking at.')
    const ai = this.doc.settings.ai
    const engineId = engineFor(ai, 'agent')
    if (engineId === 'ollama') return fail('The page agent needs Claude: your Claude Code plan or an API key (Settings > AI > Page agent).')
    if (engineId === 'claude-code' && !claudeCodeEngineAllowed()) return fail('This build cannot use a Claude plan. Pick an API key for the page agent in Settings > AI.')
    const key = this.secrets.get('anthropicKey')
    if (engineId === 'anthropic' && !key) return fail('No Anthropic API key yet. Add one in Settings > AI.')

    this.pageAgentAbort?.abort()
    const ctrl = new AbortController()
    this.pageAgentAbort = ctrl
    const run: PageAgentState = { task, tabId: id, url: wc.getURL(), since: Date.now(), running: true, text: '', earlier }
    const history = earlier.filter((t) => t.text).map((t) => ({ task: t.task, url: t.url, answer: t.text }))
    this.pageAgent = run
    this.agent.setPaused(false)
    this.agent.taskTabs.add(id)
    this.push()
    const onText = (t: string) => {
      if (this.pageAgent !== run) return
      run.text += t
      this.push()
    }
    const system = agentSystemPrompt({ id, title: wc.getTitle(), url: wc.getURL() })
    let started = false
    try {
      if (engineId === 'anthropic') {
        await runAgentWithApi({
          client: anthropicClient(key!, process.env.SOLAMAR_ANTHROPIC_BASE_URL),
          model: ai.anthropicModel,
          server: this.agent.inProcessServer(),
          system,
          task,
          history,
          signal: ctrl.signal,
          onText
        })
      } else {
        started = await this.agent.ensureServing()
        await runAgentWithClaudeCode({ url: this.agent.mcpUrl, secret: this.secrets.mcpSecret(), model: ai.claudeCodeModel || undefined, system, task, history, signal: ctrl.signal, onText })
      }
    } catch (err) {
      if (!ctrl.signal.aborted) run.error = describeEngineError(err, engineId)
    } finally {
      this.agent.taskTabs.delete(id)
      if (started) this.agent.releaseServing()
      if (this.pageAgentAbort === ctrl) this.pageAgentAbort = null
      run.running = false
      run.until = Date.now()
      run.text = run.text.trim()
      this.push()
    }
  }

  agentStop(): void {
    this.pageAgentAbort?.abort()
    this.agent.setPaused(true) // also answers any approval card the run is waiting on
    setTimeout(() => this.agent.setPaused(false), 500)
  }

  agentClear(): void {
    if (this.pageAgent?.running) return
    this.pageAgent = null
    this.push()
  }

  // ---------- save page for Claude ----------

  notice: Notice | null = null
  private noticeTimer: NodeJS.Timeout | null = null
  readonly updates = new Updates(
    () => this.push(),
    (u) =>
      u.status === 'ready'
        ? this.showNotice({ text: `Solamar ${u.next} is ready. It installs when you quit, or now.`, action: { label: 'Restart now', call: 'updateInstall' } }, 60_000)
        : this.showNotice({ text: `Solamar ${u.next} is out.`, action: { label: 'Get it', call: 'updateOpenRelease' } }, 30_000)
  )

  /** A short message at the bottom of the window; goes away on its own. */
  showNotice(n: Omit<Notice, 'id'>, ms = 10_000): void {
    this.notice = { id: uid('n-'), ...n }
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => this.dismissNotice(), ms)
    // Shown by the overlay, the only view above the pages: on its own strip, or inside a dialog that is open.
    if (!this.overlayState) this.openOverlay('notice')
    this.push()
  }

  dismissNotice(): void {
    this.notice = null
    this.restoredAfterCrash = false
    if (this.overlayState?.kind === 'notice') this.closeOverlay()
    this.push()
  }

  clipsRoot(): string {
    return this.doc.settings.clipsDir || join(app.getPath('documents'), 'Solamar Clips')
  }

  /** The open page as files Claude Code can read (see clips.ts); the folder path goes to the clipboard. */
  async saveForClaude(target?: WebContents): Promise<void> {
    const a = this.activeId()
    const wc = target ?? (a ? this.views.get(a)?.webContents : undefined)
    if (!wc || wc.isDestroyed() || !/^https?:/.test(wc.getURL())) return this.showNotice({ text: 'Open a web page first.', error: true }, 5000)
    this.showNotice({ text: `Saving ${hostOf(wc.getURL())} for Claude…` }, 60_000)
    try {
      const clip = await saveClip(wc, this.clipsRoot())
      if (process.env.SOLAMAR_HIDDEN !== '1') clipboard.writeText(clip.dir) // hidden test runs leave the user's clipboard alone
      this.showNotice({ text: 'Saved for Claude. The folder path is on the clipboard: paste it to Claude Code.', path: clip.dir }, 12_000)
    } catch (err) {
      this.showNotice({ text: 'Could not save the page: ' + (err as Error).message, error: true }, 8000)
    }
  }

  /** Opens a saved page's folder (or the clips folder); nothing outside it. */
  openClipFolder(path: string): void {
    const root = this.clipsRoot()
    const target = path && path.startsWith(root) ? path : root
    mkdirSync(target, { recursive: true })
    void shell.openPath(target)
  }

  async chooseClipsDir(): Promise<void> {
    const r = await dialog.showOpenDialog(this.win as unknown as Electron.BrowserWindow, { title: 'Folder for pages saved for Claude', defaultPath: this.clipsRoot(), properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return
    this.doc.settings.clipsDir = r.filePaths[0]
    this.changed()
  }

  // ---------- extensions ----------

  extensionInstall: ExtensionInstallPrompt | null = null
  private extensionAnswer: ((ok: boolean) => void) | null = null

  private extensionState() {
    const id = this.activeId()
    const it = this.item(id)
    const wc = id ? this.views.get(id)?.webContents : undefined
    const partition = it ? this.partitionFor(it) : this.doc.profiles[0].partition
    return {
      extensions: this.extensions.list(electronSession.fromPartition(partition)),
      extensionInstall: this.extensionInstall,
      activeWcId: wc && !wc.isDestroyed() ? wc.id : null,
      activePartition: partition
    }
  }

  private confirmExtensionInstall(prompt: ExtensionInstallPrompt): Promise<boolean> {
    this.extensionAnswer?.(false) // one card at a time; a newer Add to Chrome replaces the old one
    this.extensionInstall = prompt
    this.openOverlay('extension-install')
    return new Promise((resolve) => (this.extensionAnswer = resolve))
  }

  decideExtensionInstall(id: string, ok: boolean): void {
    if (this.extensionInstall?.id !== id) return
    const answer = this.extensionAnswer
    this.extensionAnswer = null
    this.extensionInstall = null
    if (this.overlayState?.kind === 'extension-install') this.closeOverlay()
    answer?.(ok)
    this.push()
    if (ok) setTimeout(() => this.push(), 2500) // the list refreshes once it has loaded
  }

  async uninstallExtension(id: string): Promise<void> {
    await this.extensions.uninstall(id)
    this.push()
  }

  // ---------- downloads ----------

  private downloadItems = new Map<string, Electron.DownloadItem>()

  /** Saves straight to the Downloads folder (no Save As dialog) and tracks progress for the downloads panel. */
  private onDownload(item: Electron.DownloadItem, ses: Session): void {
    const dir = process.env.SOLAMAR_DOWNLOADS_DIR || app.getPath('downloads')
    const name = item.getFilename() || 'download'
    const dot = name.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    let path = join(dir, name)
    for (let n = 1; existsSync(path) && n < 1000; n++) path = join(dir, `${stem} (${n})${ext}`)
    item.setSavePath(path)
    const priv = this.doc.profiles.some((p) => p.ephemeral && electronSession.fromPartition(p.partition) === ses)
    const d: DownloadEntry = { id: uid('d-'), name: basename(path), url: item.getURL(), path, received: 0, total: item.getTotalBytes(), state: 'progressing', startedAt: Date.now(), private: priv || undefined }
    this.doc.downloads.unshift(d)
    if (this.doc.downloads.length > 100) this.doc.downloads.length = 100
    this.downloadItems.set(d.id, item)
    item.on('updated', (_e, state) => {
      d.received = item.getReceivedBytes()
      d.total = item.getTotalBytes()
      d.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      this.push()
    })
    item.once('done', (_e, state) => {
      d.received = item.getReceivedBytes()
      d.state = state
      this.downloadItems.delete(d.id)
      if (state === 'completed' && !this.win.isFocused() && Notification.isSupported() && process.env.SOLAMAR_HIDDEN !== '1')
        new Notification({ title: 'Download finished', body: d.name }).show()
      this.changed()
    })
    this.changed()
  }

  downloadAction(id: string, action: 'open' | 'show' | 'cancel' | 'pause' | 'resume' | 'retry' | 'remove'): void {
    const d = this.doc.downloads.find((x) => x.id === id)
    if (!d) return
    const item = this.downloadItems.get(id)
    if (action === 'open' && d.state === 'completed') void shell.openPath(d.path)
    else if (action === 'show') shell.showItemInFolder(d.path)
    else if (action === 'cancel') item?.cancel()
    else if (action === 'pause') item?.pause()
    else if (action === 'resume' && item?.canResume()) item.resume()
    else if (action === 'retry') {
      const wc = this.views.get(this.activeId() ?? '')?.webContents ?? this.ui.webContents
      this.doc.downloads = this.doc.downloads.filter((x) => x.id !== id)
      wc.downloadURL(d.url)
    } else if (action === 'remove') this.doc.downloads = this.doc.downloads.filter((x) => x.id !== id)
    this.changed()
  }

  clearDownloads(): void {
    this.doc.downloads = this.doc.downloads.filter((d) => this.downloadItems.has(d.id))
    this.changed()
  }

  // ---------- history ----------

  listHistory(query: string): HistoryEntry[] {
    const q = query.trim().toLowerCase()
    return this.doc.history
      .filter((h) => !q || h.url.toLowerCase().includes(q) || (h.title ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.lastVisit - a.lastVisit)
      .slice(0, 400)
  }

  deleteHistory(url: string): void {
    this.doc.history = this.doc.history.filter((h) => h.url !== url)
    this.changed()
  }

  async clearBrowsingData(what: 'history' | 'site-data'): Promise<boolean> {
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning',
      buttons: [what === 'history' ? 'Clear history' : 'Clear cookies and site data', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: what === 'history' ? 'Clear all browsing history?' : 'Sign out of sites and clear their stored data?',
      detail: what === 'history' ? 'Your tabs, spaces and archive stay.' : 'Cookies, logins, caches and site storage in every profile are removed.'
    })
    if (response !== 0) return false
    if (what === 'history') this.doc.history = []
    else for (const ses of this.sessions) await Promise.all([ses.clearStorageData(), ses.clearCache()])
    this.changed()
    return true
  }

  // ---------- private space (incognito) ----------

  private isPrivate(spaceId: string | null | undefined): boolean {
    return !!spaceId && !!this.doc.spaces.find((s) => s.id === spaceId)?.private
  }

  /** A space whose session lives only in memory: no history, nothing written to disk, gone when Solamar closes. */
  openPrivateSpace(): void {
    let s = this.doc.spaces.find((x) => x.private)
    if (!s) {
      const profileId = uid('p-private-')
      this.doc.profiles.push({ id: profileId, name: 'Private', partition: `solamar-private-${profileId}`, isDefault: false, ephemeral: true })
      const position = Math.max(-1, ...this.doc.spaces.map((x) => x.position)) + 1
      s = { id: uid('s-'), profileId, title: 'Private', icon: 'shield', private: true, position, theme: { color: '#2b2a33', color2: '#3d3a4a', mode: 'dark', texture: 'none', intensity: 0.95 } }
      this.doc.spaces.push(s)
    }
    this.switchSpace(s.id)
    this.openOverlay('command', { mode: 'new' })
  }

  // ---------- agent (Claude Code over MCP) ----------

  private confirmNote: Notification | null = null

  /** Shows the approval card and makes sure the user notices it, even when Solamar is behind another window. */
  showConfirm(): void {
    this.openOverlay('confirm')
    const c = this.agent.currentConfirm()
    console.log(`[solamar] waiting for your OK in Solamar: ${c?.title ?? ''}`)
    if (process.env.SOLAMAR_HIDDEN === '1') return
    if (this.win.isMinimized()) this.win.restore()
    if (!this.win.isVisible()) this.win.showInactive()
    if (!this.win.isFocused()) {
      // Above every other window until the user answers, without taking the keyboard away from what they are doing.
      this.win.setAlwaysOnTop(true, 'floating')
      this.win.moveTop()
      this.win.flashFrame(true)
      if (c && Notification.isSupported()) {
        this.confirmNote?.close()
        this.confirmNote = new Notification({ title: 'Claude Code needs your OK', body: c.title, silent: false })
        this.confirmNote.on('click', () => {
          this.win.show()
          this.win.focus()
        })
        this.confirmNote.show()
      }
    }
  }

  hideConfirm(): void {
    this.win.setAlwaysOnTop(false)
    this.win.flashFrame(false)
    this.confirmNote?.close()
    this.confirmNote = null
    if (this.overlayState?.kind === 'confirm') this.closeOverlay()
  }

  /** The Claude space holds tabs Claude Code opens, away from the user's own spaces. */
  agentSpace(): Space {
    let s = this.doc.spaces.find((x) => x.agent)
    if (!s) {
      const position = Math.max(-1, ...this.doc.spaces.map((x) => x.position)) + 1
      s = {
        id: uid('s-'),
        profileId: this.doc.profiles[0].id,
        title: 'Claude',
        icon: 'terminal',
        agent: true,
        position,
        theme: { color: '#d97757', color2: '#f2b28c', mode: 'auto', texture: 'grain', intensity: 0.55 }
      }
      this.doc.spaces.push(s)
      this.changed()
    }
    return s
  }

  openAgentTab(url: string, show: boolean): string {
    return this.openTab(url, { spaceId: this.agentSpace().id, activate: show })
  }

  liveContents(id: string): WebContents | undefined {
    return this.views.get(id)?.webContents
  }

  /** Wakes a tab for the agent. Hidden tabs get the content size and keep running at full speed. */
  agentContents(id: string): WebContents {
    const v = this.ensureView(id)
    if (!this.attached.has(v)) {
      const r = this.contentRect()
      v.setBounds({ x: r.x, y: r.y, width: r.width, height: r.height })
    }
    v.webContents.setBackgroundThrottling(false)
    this.item(id)!.lastActiveAt = Date.now()
    return v.webContents
  }

  /** Screenshot of a tab. A background tab is attached for a moment underneath the frame so it paints, unseen. */
  async captureTab(id: string): Promise<Electron.NativeImage | null> {
    const v = this.ensureView(id)
    const timeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 4000))])
    if (this.attached.has(v)) return timeout(v.webContents.capturePage())
    const r = this.contentRect()
    v.setBounds({ x: r.x, y: r.y, width: r.width, height: r.height })
    this.win.contentView.addChildView(v, 0)
    try {
      await new Promise((res) => setTimeout(res, 300))
      return await timeout(v.webContents.capturePage())
    } finally {
      if (!this.attached.has(v)) this.win.contentView.removeChildView(v)
    }
  }

  setShared(id: string, on: boolean): void {
    const it = this.item(id)
    if (it?.kind !== 'tab') return
    it.shared = on || undefined
    this.changed()
  }

  // ---------- command bar ----------

  query(text: string): CommandResult[] {
    const q = text.trim()
    let navigate: CommandResult | null = null
    if (q && !q.startsWith('>')) {
      const n = toNavigable(q, this.doc.settings.searchEngine)
      navigate = n.isSearch
        ? { id: 'nav', kind: 'search', title: q, subtitle: 'Search', url: n.url, score: 1000 }
        : { id: 'nav', kind: 'url', title: n.url, subtitle: 'Open', url: n.url, score: 1000 }
    }
    const tabs = this.doc.items.filter((i) => i.kind === 'tab' && i.url && (i.section === 'favorites' || i.spaceId === this.doc.window.focusedSpaceId))
    return rankResults(q.replace(/^>\s*/, ''), tabs, q.startsWith('>') ? [] : this.doc.history, ACTIONS, navigate)
  }

  /** Runs a command bar result. `inPlace` loads the URL in the active tab (edit-address mode). */
  pick(r: CommandResult, inPlace: boolean): void {
    this.closeOverlay()
    if (r.kind === 'tab' && r.itemId) return this.activate(r.itemId)
    if (r.kind === 'action' && r.action) return this.runAction(r.action)
    if (!r.url) return
    const a = this.activeId()
    if (inPlace && a) {
      this.ensureView(a).webContents.loadURL(r.url).catch(() => {})
      this.views.get(a)?.webContents.focus()
    } else this.openTab(r.url)
  }

  runAction(id: string): void {
    switch (id) {
      case 'space-new':
        return this.openOverlay('space-new', { mode: 'new' })
      case 'theme':
        return this.openOverlay('theme', { mode: 'edit', spaceId: this.doc.window.focusedSpaceId })
      case 'import-arc':
        return this.openOverlay('import')
      case 'import-browser':
        return this.openOverlay('import-browser')
      case 'aiTidy':
        return void this.aiTidy()
      case 'boost':
        return this.openBoost()
      case 'save-for-claude':
        return void this.saveForClaude()
      case 'adblock-site': {
        const site = siteOf(this.item(this.activeId())?.url)
        if (site) this.toggleAllowSite(site)
        return
      }
      default:
        if (id in COMMAND_LABELS) this.run(id as CommandId)
    }
  }

  // ---------- commands and shortcuts ----------

  setShortcutsSuspended(on: boolean): void {
    this.shortcutsSuspended = on
  }

  private onKey(e: Electron.Event, input: Input): void {
    if (input.type !== 'keyDown' || this.shortcutsSuspended) return
    // The input method has this key (Enter or Esc while a Korean, Japanese or Chinese character is being composed).
    if (input.isComposing || input.key === 'Process') return
    const acc = MAC ? macShortcut(accelerator(input)) : accelerator(input)
    if (!acc) return
    if (acc === 'Esc' && this.overlayState && this.overlayState.kind !== 'notice') {
      e.preventDefault()
      const c = this.overlayState.kind === 'confirm' ? this.agent.currentConfirm() : null
      if (c) return this.agent.decide(c.id, 'deny')
      const pr = this.overlayState.kind === 'permission' ? this.permQueue[0] : null
      if (pr) return this.decidePermission(pr.req.id, 'dismiss')
      if (this.overlayState.kind === 'save-password') return void this.decideSavePassword('dismiss')
      if (this.overlayState.kind === 'extension-install' && this.extensionInstall) return this.decideExtensionInstall(this.extensionInstall.id, false)
      return this.closeOverlay()
    }
    // Usual browser keys that are not in the shortcut editor.
    const fixed: Record<string, CommandId> = { F5: 'reload', 'Ctrl+F5': 'hardReload', 'Shift+F5': 'hardReload' }
    if (fixed[acc]) {
      e.preventDefault()
      return this.run(fixed[acc])
    }
    const n = /^(Ctrl|Alt)\+([1-9])$/.exec(acc)
    if (n) {
      e.preventDefault()
      const k = Number(n[2])
      if (n[1] === 'Ctrl') {
        const tabs = this.flatTabs()
        const t = k === 9 ? tabs[tabs.length - 1] : tabs[k - 1]
        if (t) this.activate(t.id)
      } else {
        const s = [...this.doc.spaces].sort((a, b) => a.position - b.position)[k - 1]
        if (s) this.switchSpace(s.id)
      }
      return
    }
    const map = this.doc.settings.shortcuts
    // On macOS a binding recorded as Meta+T (Command+T) is the same as Ctrl+T.
    const key = (b: string) => (MAC ? macShortcut(normalizeAccelerator(b)) || normalizeAccelerator(b) : normalizeAccelerator(b))
    const cmd = (Object.keys(map) as CommandId[]).find((c) => key(map[c]) === acc)
    if (cmd) {
      e.preventDefault()
      this.run(cmd)
    }
  }

  run(cmd: CommandId): void {
    const a = this.activeId()
    const wc = a ? this.views.get(a)?.webContents : undefined
    switch (cmd) {
      case 'newTab':
        return this.overlayState?.kind === 'command' ? this.closeOverlay() : this.openOverlay('command', { mode: 'new' })
      case 'focusUrl':
        return this.openOverlay('command', { mode: 'edit', text: this.item(a)?.url ?? '' })
      case 'closeTab':
        return this.closeTab(a)
      case 'reopenTab': {
        const c = this.closed.pop()
        if (c) this.openTab(c.url, { spaceId: c.spaceId ?? undefined })
        return
      }
      case 'reload':
        return wc?.reload()
      case 'hardReload':
        return wc?.reloadIgnoringCache()
      case 'back':
        return wc?.navigationHistory.canGoBack() ? wc.navigationHistory.goBack() : undefined
      case 'forward':
        return wc?.navigationHistory.canGoForward() ? wc.navigationHistory.goForward() : undefined
      case 'toggleSidebar':
        void this.animateLayout(() => (this.doc.settings.sidebarVisible = !this.doc.settings.sidebarVisible))
        return this.store.save()
      case 'pinTab':
        return this.togglePin(a)
      case 'nextTab':
      case 'prevTab': {
        const tabs = this.flatTabs()
        if (!tabs.length) return
        const i = tabs.findIndex((t) => t.id === a)
        const next = tabs[(i + (cmd === 'nextTab' ? 1 : -1) + tabs.length) % tabs.length]
        return this.activate(next.id)
      }
      case 'nextSpace':
        return this.cycleSpace(1)
      case 'prevSpace':
        return this.cycleSpace(-1)
      case 'copyUrl': {
        const url = this.item(a)?.url
        if (url) clipboard.writeText(url)
        return
      }
      case 'splitView': {
        if (this.doc.window.split.length > 1 && this.doc.window.split.includes(a ?? '')) return this.unsplit()
        const tabs = this.flatTabs()
        const i = tabs.findIndex((t) => t.id === a)
        const other = tabs[i + 1] ?? tabs[i - 1]
        if (other) this.splitWith(other.id)
        return
      }
      case 'settings':
        return this.openOverlay('settings')
      case 'archive':
        return this.openOverlay('archive')
      case 'history':
        return this.openOverlay('history')
      case 'downloads':
        return this.openOverlay('downloads')
      case 'privateSpace':
        return this.openPrivateSpace()
      case 'aiPanel':
        if (this.boostEditor?.zapping) this.stopZap()
        void this.animateLayout(() => {
          this.ai.panelOpen = !this.ai.panelOpen
          if (this.ai.panelOpen) this.boostEditor = null
        })
        if (this.ai.panelOpen && this.doc.settings.ai.enabled) void this.aiStatus()
        return
      case 'aiSummarize':
        return void this.aiSummarize()
      case 'aiWrite':
        return void this.aiWriteStart()
      case 'zoomIn':
        return a ? this.zoom(a, 0.1) : undefined
      case 'zoomOut':
        return a ? this.zoom(a, -0.1) : undefined
      case 'zoomReset':
        return a ? this.zoom(a, 0) : undefined
      case 'devtools':
        return wc?.toggleDevTools()
    }
  }

  private zoom(id: string, delta: number): void {
    const wc = this.views.get(id)?.webContents
    const rt = this.runtime[id]
    if (!wc || !rt) return
    rt.zoom = delta === 0 ? 1 : Math.max(0.3, Math.min(3, Math.round((rt.zoom + delta) * 10) / 10))
    wc.setZoomFactor(rt.zoom)
    this.push()
  }

  nav(action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const a = this.activeId()
    const wc = a ? this.views.get(a)?.webContents : undefined
    if (!wc) return
    if (action === 'stop') wc.stop()
    else this.run(action)
  }

  // ---------- menus ----------

  itemMenu(id: string): void {
    const it = this.item(id)
    if (!it) return
    const others = this.doc.spaces.filter((s) => s.id !== it.spaceId)
    const t: Electron.MenuItemConstructorOptions[] = []
    if (it.kind === 'tab') {
      t.push({ label: 'Rename…', click: () => this.openRename(id) })
      if (it.section !== 'favorites') t.push({ label: it.section === 'pinned' ? 'Unpin' : 'Pin', click: () => this.togglePin(id) })
      t.push(
        it.section === 'favorites'
          ? { label: 'Remove from favorites', click: () => this.moveItem(id, { section: 'pinned', parentId: null, index: 0, spaceId: this.doc.window.focusedSpaceId }) }
          : { label: 'Add to favorites', click: () => this.moveItem(id, { section: 'favorites', parentId: null, index: 99 }) }
      )
      if (this.activeId() && this.activeId() !== id) t.push({ label: 'Open in split view', click: () => this.splitWith(id) })
      t.push(
        { label: 'Duplicate', click: () => this.duplicate(id) },
        { label: 'Copy link', click: () => it.url && clipboard.writeText(it.url) }
      )
      if (this.views.has(id) && this.activeId() !== id) t.push({ label: 'Unload (sleep)', click: () => (this.sleep(id), this.push()) })
      if (this.doc.settings.agent.mcpEnabled && !this.doc.spaces.find((s) => s.id === it.spaceId)?.agent)
        t.push({ label: it.shared ? 'Stop sharing with Claude Code' : 'Share with Claude Code', click: () => this.setShared(id, !it.shared) })
    } else {
      t.push({ label: 'Rename…', click: () => this.openRename(id) }, { label: 'New folder inside', click: () => this.createFolder(it.section, id) })
    }
    if (others.length && it.section !== 'favorites')
      t.push({ label: 'Move to space', submenu: others.map((s) => ({ label: s.title, click: () => this.moveItem(id, { section: it.section, parentId: null, index: 0, spaceId: s.id }) })) })
    t.push({ type: 'separator' })
    t.push(
      it.kind === 'tab' && it.section === 'today'
        ? { label: 'Close tab', click: () => this.closeTab(id) }
        : { label: it.kind === 'folder' ? 'Delete folder and its tabs' : 'Delete', click: () => this.deleteItem(id) }
    )
    Menu.buildFromTemplate(t).popup({ window: this.win as any })
  }

  spaceMenu(id: string): void {
    const s = this.doc.spaces.find((x) => x.id === id)
    if (!s) return
    const profiles = this.doc.profiles
    Menu.buildFromTemplate([
      { label: 'Edit theme and name…', click: () => this.openOverlay('theme', { mode: 'edit', spaceId: id }) },
      {
        label: 'Profile',
        submenu: [
          ...profiles.map((p) => ({ label: p.name, type: 'radio' as const, checked: p.id === s.profileId, click: () => this.updateSpace(id, { profileId: p.id }) })),
          { type: 'separator' as const },
          { label: 'New profile (separate logins)', click: () => this.updateSpace(id, { profileId: this.createProfile(`${s.title} profile`) }) }
        ]
      },
      { label: 'New folder', click: () => this.createFolder('pinned') },
      { type: 'separator' },
      { label: 'Delete space…', enabled: this.doc.spaces.length > 1, click: () => void this.deleteSpace(id) }
    ]).popup({ window: this.win as any })
  }

  createProfile(name: string): string {
    const id = uid('p-')
    this.doc.profiles.push({ id, name: name.slice(0, 40), partition: `persist:solamar-${id}`, isDefault: false })
    this.changed()
    return id
  }

  private openRename(id: string): void {
    const it = this.item(id)
    this.openOverlay('command', { mode: 'edit', tab: id, text: it?.customTitle || it?.title || '' })
  }

  private pageMenu(wc: WebContents, p: Electron.ContextMenuParams): void {
    const t: Electron.MenuItemConstructorOptions[] = []
    const web = /^https?:/.test(wc.getURL())
    if (p.linkURL) {
      t.push(
        { label: 'Open link in Peek', enabled: /^https?:/i.test(p.linkURL), click: () => this.openPeek(p.linkURL, wc) },
        { label: 'Open link in new tab', click: () => this.openTab(p.linkURL, { after: this.wcToItem.get(wc.id), activate: false }) },
        { label: 'Open link in split view', click: () => this.splitWith(this.openTab(p.linkURL, { activate: false })) },
        { label: 'Copy link', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' }
      )
    }
    if (p.hasImageContents && p.srcURL) {
      t.push(
        { label: 'Open image in new tab', click: () => this.openTab(p.srcURL) },
        { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
        { type: 'separator' }
      )
    }
    if (p.isEditable && p.formControlType !== 'input-password') {
      t.push(
        { label: 'Write with AI…', accelerator: this.doc.settings.shortcuts.aiWrite, click: () => void this.aiWriteStart(wc) },
        { label: 'Draft a reply with AI', click: () => void this.aiWriteStart(wc, 'reply') },
        { type: 'separator' }
      )
    }
    if (p.isEditable) {
      for (const s of p.dictionarySuggestions.slice(0, 4)) t.push({ label: s, click: () => wc.replaceMisspelling(s) })
      if (p.dictionarySuggestions.length) t.push({ type: 'separator' })
      t.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' })
    } else if (p.selectionText) {
      const q = p.selectionText.trim().slice(0, 200)
      t.push({ role: 'copy' }, { label: `Search for "${q.length > 30 ? q.slice(0, 30) + '…' : q}"`, click: () => this.openTab(toNavigable(q, this.doc.settings.searchEngine).url) }, { type: 'separator' })
    }
    t.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      ...(this.wcToItem.has(wc.id) && web ? [{ label: 'Boost this site…', click: () => this.openBoost() }] : []),
      ...(web ? [{ label: 'Save page for Claude', click: () => void this.saveForClaude(wc) }] : []),
      { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) }
    )
    const menu = Menu.buildFromTemplate(t)
    const fromExtensions = this.extensions.contextMenuItems(wc, p)
    if (fromExtensions.length) {
      menu.insert(menu.items.length - 2, new MenuItem({ type: 'separator' }))
      for (const item of fromExtensions) menu.insert(menu.items.length - 2, item)
    }
    menu.popup({ window: this.win as any })
  }

  // ---------- ad block ----------

  toggleAllowSite(site: string): void {
    const list = this.doc.settings.adblock.allowlist
    this.doc.settings.adblock.allowlist = list.includes(site) ? list.filter((d) => d !== site) : [...list, site]
    this.adblock.setAllowlist(this.doc.settings.adblock.allowlist)
    this.views.get(this.activeId() ?? '')?.webContents.reload()
    this.changed()
  }

  // ---------- AI features (engines: local Ollama or the user's own Anthropic key) ----------

  private engine(feature: AiFeature): Engine {
    const ai = this.doc.settings.ai
    if (engineFor(ai, feature) === 'claude-code') {
      if (!claudeCodeEngineAllowed()) throw new Error('This build cannot use a Claude plan. Pick the local model or an API key in Settings > AI.')
      return claudeCodeEngine(ai.claudeCodeModel)
    }
    if (engineFor(ai, feature) === 'anthropic') {
      const key = this.secrets.get('anthropicKey')
      if (!key) throw new Error('No Anthropic API key yet. Add one in Settings > Local AI, or switch this feature to the local model.')
      return anthropicEngine(key, ai.anthropicModel, process.env.SOLAMAR_ANTHROPIC_BASE_URL)
    }
    if (!ai.model) throw new Error('Pick a local model in Settings > Local AI (run: ollama pull llama3.2).')
    return ollamaEngine(ai)
  }

  async aiStatus(): Promise<void> {
    const s = this.doc.settings.ai
    this.ai.hasKey = this.secrets.has('anthropicKey')
    this.ai.keyStorage = this.secrets.available
    try {
      this.ai.models = await ollamaStatus(s)
      if (this.ai.models.length && !this.ai.models.includes(s.model)) {
        s.model = this.ai.models[0]
        this.store.save()
      }
    } catch {
      this.ai.models = []
    }
    const usesLocal = s.engine === 'ollama' || Object.values(s.features).includes('ollama')
    const usesClaude = s.engine === 'anthropic' || Object.values(s.features).includes('anthropic')
    const usesClaudeCode = s.engine === 'claude-code' || Object.values(s.features).includes('claude-code')
    const problems: string[] = []
    if (usesClaudeCode && !claudeCodeEngineAllowed()) problems.push('This build cannot use a Claude plan.')
    else if (usesClaudeCode && !(await claudeCliVersion())) problems.push('Claude Code is not installed on this PC (claude.com/claude-code).')
    if (usesLocal && !this.ai.models.length) problems.push('Ollama is not running here or has no models (install from ollama.com, then: ollama pull llama3.2).')
    if (usesClaude && !this.ai.hasKey) problems.push('Add your Anthropic API key in Settings > Local AI.')
    this.ai.available = problems.length === 0
    this.ai.error = problems.join(' ') || undefined
    this.push()
  }

  async setAnthropicKey(key: string | null): Promise<{ ok: boolean; error?: string }> {
    try {
      if (key) await checkAnthropicKey(key, process.env.SOLAMAR_ANTHROPIC_BASE_URL)
      await this.secrets.set('anthropicKey', key)
      await this.aiStatus()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: key ? describeEngineError(err, 'anthropic') : (err as Error).message }
    }
  }

  private async pageText(): Promise<{ title: string; url: string; text: string } | null> {
    const a = this.activeId()
    const wc = a ? this.views.get(a)?.webContents : undefined
    if (!wc) return null
    const text: string = await wc
      .executeJavaScript(`(document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${PAGE_TEXT_LIMIT})`, true)
      .catch(() => '')
    return { title: wc.getTitle(), url: wc.getURL(), text }
  }

  private async aiReady(): Promise<boolean> {
    if (!this.doc.settings.ai.enabled) {
      if (!this.ai.panelOpen) void this.animateLayout(() => (this.ai.panelOpen = true))
      this.push()
      return false
    }
    if (this.ai.available !== true) await this.aiStatus()
    return true
  }

  private async stream(feature: AiFeature, messages: ChatMessage[], into: { content: string }, json = false): Promise<void> {
    this.aiAbort?.abort()
    const ctrl = new AbortController()
    this.aiAbort = ctrl
    const timeout = setTimeout(() => ctrl.abort(), 180_000)
    this.ai.busy = true
    this.ai.error = undefined
    this.push()
    let engine: Engine | null = null
    try {
      engine = this.engine(feature)
      // Page text reaches the model only as delimited, untrusted data.
      const guarded: ChatMessage[] = [{ role: 'system', content: UNTRUSTED_RULE }, ...messages]
      for await (const chunk of engine.stream(guarded, { signal: ctrl.signal, json, fast: feature === 'write' || feature === 'search' })) {
        into.content += chunk
        this.push()
      }
    } catch (err) {
      if (!ctrl.signal.aborted) this.ai.error = describeEngineError(err, engine?.id ?? engineFor(this.doc.settings.ai, feature))
    } finally {
      clearTimeout(timeout)
      if (this.aiAbort === ctrl) this.aiAbort = null
      this.ai.busy = false
      this.push()
    }
  }

  async aiSummarize(): Promise<void> {
    if (!this.ai.panelOpen) void this.animateLayout(() => (this.ai.panelOpen = true))
    if (!(await this.aiReady())) return
    const page = await this.pageText()
    if (!page?.text.trim()) {
      this.ai.error = 'This page has no readable text.'
      return this.push()
    }
    this.ai.messages = [{ role: 'user', content: `Summarize: ${page.title || hostOf(page.url)}` }]
    const reply = { role: 'assistant' as const, content: '' }
    this.ai.messages.push(reply)
    await this.stream('summarize', summarizePrompt(page.title, page.url, wrapUntrusted(page.text, hostOf(page.url))), reply)
  }

  async aiAsk(question: string): Promise<void> {
    const q = question.trim()
    if (!q || !(await this.aiReady())) return
    const page = await this.pageText()
    const history = this.ai.messages.map((m) => ({ role: m.role, content: m.content }))
    this.ai.messages.push({ role: 'user', content: q })
    const reply = { role: 'assistant' as const, content: '' }
    this.ai.messages.push(reply)
    await this.stream('ask', askPrompt(page?.title ?? '', page?.url ?? '', page ? wrapUntrusted(page.text, hostOf(page.url)) : '', history, q), reply)
  }

  async aiTidy(): Promise<void> {
    if (!this.ai.panelOpen) void this.animateLayout(() => (this.ai.panelOpen = true))
    if (!(await this.aiReady())) return
    const tabs = this.siblings(this.doc.window.focusedSpaceId, 'today', null).filter((i) => i.kind === 'tab')
    if (tabs.length < 3) {
      this.ai.error = 'Tidy needs at least 3 today tabs.'
      return this.push()
    }
    const list = tabs.slice(0, 60).map((t, i) => ({ n: i + 1, title: (t.customTitle || t.title || '').slice(0, 80), host: hostOf(t.url) }))
    this.ai.tidy = null
    const out = { content: '' }
    this.ai.messages.push({ role: 'user', content: `Tidy ${list.length} today tabs` })
    await this.stream('tidy', tidyPrompt(list), out, true)
    const groups = parseTidy(out.content, list.length)
    this.ai.tidy = groups.map((g) => ({ title: g.title, itemIds: g.tabs.map((n) => tabs[n - 1].id) }))
    this.ai.messages.push({
      role: 'assistant',
      content: groups.length ? `Suggested ${groups.length} folders. Review and apply below.` : 'The model gave no usable grouping. Try again or pick another model.'
    })
    this.push()
  }

  applyTidy(): void {
    const groups = this.ai.tidy
    if (!groups) return
    groups.forEach((g, gi) => {
      const folder = this.createFolder('today', null, g.title)
      g.itemIds.forEach((id, i) => this.item(id) && this.moveItem(id, { section: 'today', parentId: folder, index: i }))
      this.item(folder)!.position = -100 + gi
    })
    this.ai.tidy = null
    this.ai.messages.push({ role: 'assistant', content: 'Done. Folders are at the top of Today.' })
    this.changed()
  }

  aiCancel(): void {
    this.aiAbort?.abort()
  }

  aiClear(): void {
    this.aiAbort?.abort()
    this.ai.messages = []
    this.ai.tidy = null
    this.ai.error = undefined
    this.push()
  }

  // ---------- Write with AI (any text field) and AI search help ----------

  write: WriteState | null = null
  answer: AnswerState | null = null
  private writeTarget: { wc: WebContents; field: FieldInfo } | null = null
  private writeAbort: AbortController | null = null
  private answerAbort: AbortController | null = null
  private rewriteAbort: AbortController | null = null
  private rewriteCache = new Map<string, string | null>()

  /** Runs one engine call for a feature and streams text to onText. Returns an error message, or undefined. */
  private async engineRun(feature: AiFeature, messages: ChatMessage[], ctrl: AbortController, onText: (t: string) => void): Promise<string | undefined> {
    if (!this.doc.settings.ai.enabled) return 'Turn on AI in Settings > AI first.'
    let engine: Engine | null = null
    try {
      engine = this.engine(feature)
      for await (const chunk of engine.stream([{ role: 'system', content: UNTRUSTED_RULE }, ...messages], { signal: ctrl.signal, fast: true })) onText(chunk)
      return undefined
    } catch (err) {
      return ctrl.signal.aborted ? undefined : describeEngineError(err, engine?.id ?? engineFor(this.doc.settings.ai, feature))
    }
  }

  /** Opens the writing dialog for the focused field of a tab (or the one right-clicked). */
  async aiWriteStart(wc?: WebContents, then?: WriteAction): Promise<void> {
    const a = this.activeId()
    const target = wc ?? (a ? this.views.get(a)?.webContents : undefined)
    if (!target) return
    const field = (await target.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: fieldJs() }], true).catch(() => null)) as FieldInfo | null
    const site = siteOf(target.getURL())
    if (!field || field.sensitive) {
      this.write = {
        site,
        field: '',
        original: '',
        scope: 'field',
        busy: false,
        result: '',
        error: field?.sensitive ? 'Solamar never sends passwords, card numbers or codes to AI.' : 'Click into a text field on the page first, then press ' + this.doc.settings.shortcuts.aiWrite + '.'
      }
      this.writeTarget = null
    } else {
      const scope = field.selected.trim() ? 'selection' : 'field'
      this.write = { site, field: field.name, original: scope === 'selection' ? field.selected : field.value, scope, busy: false, result: '' }
      this.writeTarget = { wc: target, field }
    }
    this.openOverlay('write')
    if (then && this.writeTarget) void this.aiWriteRun(then, '')
  }

  async aiWriteRun(action: WriteAction, instruction: string): Promise<void> {
    const w = this.write
    if (!w || !this.writeTarget) return
    if (action === 'custom' && !instruction.trim()) return
    this.writeAbort?.abort()
    const ctrl = new AbortController()
    this.writeAbort = ctrl
    let messages
    if (action === 'reply') {
      // The thread is the page text near the end, where the latest messages usually are.
      const tail: string = await this.writeTarget.wc
        .executeJavaScript(`(document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(-${PAGE_TEXT_LIMIT})`, true)
        .catch(() => '')
      messages = replyPrompt(tail, [w.original, instruction].filter((x) => x.trim()).join('\n'), w.field, w.site)
    } else if (action === 'custom' && !instruction.trim()) return
    // An empty field with an instruction means: write it from scratch.
    else messages = w.original.trim() ? writePrompt(action, instruction, w.original, w.field, w.site) : writePrompt('custom', `Write this: ${instruction}`, '', w.field, w.site)
    Object.assign(w, { busy: true, result: '', error: undefined, applied: false })
    this.push()
    const error = await this.engineRun('write', messages, ctrl, (t) => {
      w.result += t
      this.push()
    })
    if (this.writeAbort !== ctrl) return
    this.writeAbort = null
    w.busy = false
    w.result = cleanEdit(w.result)
    w.error = error
    this.push()
  }

  async aiWriteApply(edited?: string): Promise<void> {
    const t = this.writeTarget
    const w = this.write
    if (!t || !w?.result || t.wc.isDestroyed()) return
    const text = cleanEdit(edited ?? w.result)
    this.write = null
    this.closeOverlay() // gives the page its focus back; insertText needs a focused document
    await new Promise((r) => setTimeout(r, 60))
    const r = (await t.wc
      .executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: applyFieldJs(t.field.ref, text, w.scope === 'selection', t.field.start, t.field.end) }], true)
      .catch((e) => ({ ok: false, error: String(e) }))) as { ok: boolean; error?: string }
    this.writeTarget = null
    if (!r.ok) {
      this.write = { ...w, error: r.error, applied: false }
      this.writeTarget = t
      this.openOverlay('write')
    }
  }

  /** A better search query for what was typed in the command bar (null when there is none). Cached per query. */
  async aiRewrite(query: string): Promise<string | null> {
    const q = query.trim()
    if (!this.doc.settings.ai.enabled || !looksLikeQuestion(q)) return null
    if (this.rewriteCache.has(q)) return this.rewriteCache.get(q)!
    this.rewriteAbort?.abort()
    const ctrl = new AbortController()
    this.rewriteAbort = ctrl
    let out = ''
    const error = await this.engineRun('search', rewritePrompt(q), ctrl, (t) => (out += t))
    if (ctrl.signal.aborted || error) return null
    const better = cleanQuery(out, q)
    this.rewriteCache.set(q, better)
    if (this.rewriteCache.size > 200) this.rewriteCache.delete(this.rewriteCache.keys().next().value!)
    return better
  }

  /** Short answer in the command bar. Claude (plan or API) searches the web and cites sources; a local model answers from memory. */
  async aiAnswer(question: string): Promise<void> {
    const q = question.trim()
    if (!q) return
    this.answerAbort?.abort()
    const ctrl = new AbortController()
    this.answerAbort = ctrl
    const ai = this.doc.settings.ai
    const engine = engineFor(ai, 'search')
    const a: AnswerState = { question: q, busy: true, text: '', sources: [], web: engine !== 'ollama' }
    this.answer = a
    this.push()
    const onText = (t: string) => {
      a.text += t
      this.push()
    }
    let error: string | undefined
    if (!ai.enabled) error = 'Turn on AI in Settings > AI first.'
    else {
      try {
        if (engine === 'claude-code') {
          if (!claudeCodeEngineAllowed()) throw new Error('This build cannot use a Claude plan.')
          for await (const t of claudeCodeWebAnswer(q, ai.claudeCodeModel, ctrl.signal)) onText(t)
        } else if (engine === 'anthropic') {
          const key = this.secrets.get('anthropicKey')
          if (!key) throw new Error('No Anthropic API key yet. Add one in Settings > AI.')
          for await (const t of anthropicWebAnswer(anthropicClient(key, process.env.SOLAMAR_ANTHROPIC_BASE_URL), ai.anthropicModel, q, ctrl.signal, a.sources)) onText(t)
        } else {
          error = await this.engineRun('search', localAnswerPrompt(q), ctrl, onText)
        }
      } catch (err) {
        if (!ctrl.signal.aborted) error = describeEngineError(err, engine)
      }
    }
    if (this.answerAbort !== ctrl) return
    this.answerAbort = null
    for (const s of linksIn(a.text)) if (!a.sources.some((x) => x.url === s.url)) a.sources.push(s)
    a.busy = false
    a.error = error
    this.push()
  }

  aiAnswerClear(): void {
    this.answerAbort?.abort()
    this.answerAbort = null
    this.answer = null
    this.push()
  }

  // ---------- misc ----------

  openExternal(url: string): void {
    if (/^https?:/.test(url)) void shell.openExternal(url)
  }

  isOwnWebContents(wc: WebContents): boolean {
    return wc === this.ui.webContents || wc === this.overlay.webContents
  }

  frameBackground(): string {
    return frameColors(this.space().theme, nativeTheme.shouldUseDarkColors).from
  }

  quit(): void {
    this.saveSessions(true)
    this.saveBounds()
    this.store.flush()
    app.quit()
  }
}
