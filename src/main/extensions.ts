// Chrome extensions: electron-chrome-extensions (used under its GPL-3.0 option) gives pages and extensions the
// chrome.tabs / windows / action APIs; electron-chrome-web-store installs and updates extensions from the Chrome
// Web Store. Every saved profile shares one extensions folder; private spaces run without extensions, like Chrome's
// incognito windows.
import { join } from 'node:path'
import { app, session as electronSession, type BaseWindow, type ContextMenuParams, type MenuItem, type Session, type WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, uninstallExtension } from 'electron-chrome-web-store'
import type { ExtensionInfo, ExtensionInstallPrompt } from '@shared/types'
import { uid } from '@shared/util'

export interface ExtensionHost {
  win: BaseWindow
  /** Opens a tab for an extension (chrome.tabs.create / windows.create) in a space that uses this session. */
  createTab(url: string, active: boolean, ses: Session): WebContents
  selectTab(wc: WebContents): void
  closeTab(wc: WebContents): void
  /** Shows Solamar's own "Add this extension?" card; resolves with the user's answer. */
  confirmInstall(prompt: ExtensionInstallPrompt): Promise<boolean>
}

type Manifest = {
  permissions?: string[]
  host_permissions?: string[]
  optional_host_permissions?: string[]
  content_scripts?: { matches?: string[] }[]
}

const BROAD = ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']

/** What an extension may do, in plain words, for the install card. */
export function describePermissions(m: Manifest): string[] {
  const out: string[] = []
  const hosts = [...(m.host_permissions ?? []), ...(m.content_scripts ?? []).flatMap((c) => c.matches ?? [])]
  if (hosts.some((h) => BROAD.includes(h))) out.push('Read and change everything on all websites')
  else {
    const names = [...new Set(hosts.map((h) => h.replace(/^[a-z*]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')).filter(Boolean))]
    if (names.length) out.push(`Read and change your data on ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more sites` : ''}`)
  }
  const words: Record<string, string> = {
    tabs: 'See your open tabs and their addresses',
    history: 'Read and change your browsing history',
    bookmarks: 'Read and change your bookmarks',
    cookies: 'Read and change cookies',
    downloads: 'Manage your downloads',
    clipboardRead: 'Read what you copy',
    clipboardWrite: 'Change what is on the clipboard',
    nativeMessaging: 'Talk to programs installed on this computer',
    webRequest: 'See your network traffic',
    declarativeNetRequest: 'Block or change content on pages',
    notifications: 'Show notifications',
    scripting: 'Run scripts on the pages it can access',
    debugger: 'Use the page debugger (full control of pages)',
    management: 'Manage your other extensions',
    privacy: 'Change privacy settings',
    proxy: 'Change how Solamar connects to the internet',
    geolocation: 'Know your location'
  }
  for (const p of m.permissions ?? []) if (words[p] && !out.includes(words[p])) out.push(words[p])
  return out
}

export class Extensions {
  private readonly bySession = new Map<Session, ElectronChromeExtensions>()
  readonly path = join(app.getPath('userData'), 'Extensions')

  constructor(private readonly host: ExtensionHost) {
    // Extension icons in Solamar's own UI (toolbar, settings) come through crx:// in the UI's session.
    ElectronChromeExtensions.handleCRXProtocol(electronSession.defaultSession)
  }

  /** Turns extensions on in a saved profile's session (private, in-memory sessions are skipped). */
  attach(ses: Session): void {
    if (this.bySession.has(ses) || !ses.isPersistent()) return
    const asWindow = this.host.win as unknown as Electron.BrowserWindow
    const ext = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: ses,
      createTab: async (details) => [this.host.createTab(details.url || 'about:blank', details.active !== false, ses), asWindow],
      selectTab: (wc) => this.host.selectTab(wc),
      // The library also calls this when a tab's page goes away (Solamar putting a tab to sleep); only a live
      // tab that an extension asked to close is closed.
      removeTab: (wc) => setImmediate(() => !wc.isDestroyed() && this.host.closeTab(wc)),
      createWindow: async (details) => {
        for (const u of [details.url ?? []].flat()) this.host.createTab(u, true, ses)
        return asWindow
      },
      requestPermissions: async () => true
    })
    this.bySession.set(ses, ext)
    void installChromeWebStore({
      session: ses,
      extensionsPath: this.path,
      beforeInstall: async (d) => {
        const icon = d.icon && !d.icon.isEmpty() ? d.icon.resize({ width: 48, height: 48 }).toDataURL() : ''
        const ok = await this.host.confirmInstall({ id: uid('ext-'), extensionId: d.id, name: d.localizedName, icon, permissions: describePermissions(d.manifest as Manifest) })
        return { action: ok ? 'allow' : 'deny' }
      }
    }).catch((err) => console.error('[extensions] web store', err))
  }

  addTab(wc: WebContents): void {
    this.bySession.get(wc.session)?.addTab(wc, this.host.win as unknown as Electron.BrowserWindow)
  }

  selectTab(wc: WebContents): void {
    this.bySession.get(wc.session)?.selectTab(wc)
  }

  contextMenuItems(wc: WebContents, params: ContextMenuParams): MenuItem[] {
    return this.bySession.get(wc.session)?.getContextMenuItems(wc, params) ?? []
  }

  list(ses: Session): ExtensionInfo[] {
    if (!this.bySession.has(ses)) return []
    return ses.extensions
      .getAllExtensions()
      .map((e) => ({ id: e.id, name: e.name, version: e.version, description: String((e.manifest as { description?: string }).description ?? '').slice(0, 200) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Removes an extension from every profile and deletes its files. */
  async uninstall(id: string): Promise<void> {
    let removedFiles = false
    for (const ses of this.bySession.keys()) {
      if (!ses.extensions.getExtension(id)) continue
      if (!removedFiles) {
        await uninstallExtension(id, { session: ses, extensionsPath: this.path }).catch(() => ses.extensions.removeExtension(id))
        removedFiles = true
      } else ses.extensions.removeExtension(id)
    }
  }
}
