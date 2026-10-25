import { unlinkSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { app, clipboard, ipcMain, Menu, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import { AI_FEATURES, ANTHROPIC_MODELS, APP_ICONS, BOOST_FONTS } from '@shared/defaults'
import type { AiFeature, Section, Settings, SpaceTheme } from '@shared/types'
import { isSpaceIcon } from '@shared/icons'
import { normalizeAccelerator } from '@shared/util'
import { AdBlock } from './adblock'
import { applyArcPlan, locateArcSidebar, previewPlan, readArcPlan } from './arc-import'
import { ArcFormatError } from './arc-parse'
import { applyImport, type ImportSource, listSources, readSource } from './importers'
import { Browser } from './browser'
import { RELEASES_URL } from './updates'
import { moveOldClips, moveOldProfile, OLD_NAME, settingsFile } from './old-name'
import { Secrets } from './secrets'
import { Store } from './store'
import { Vault, VaultLockedError } from './vault'
import { parsePasswordsCsv } from './importers'

app.setName('Solamar')

// Logged, not fatal. (Ad block scriptlets no longer run through webContents.executeJavaScript, see adblock.ts, so
// its "Script failed to execute" rejections are gone rather than silenced.)
process.on('unhandledRejection', (err) => {
  console.error('[solamar] unhandled rejection', err)
})
// Present as plain Chrome. Facebook, Google and others refuse or quietly fail logins from browsers whose
// User-Agent names Electron or an unknown app ("embedded browser"), even with the right password.
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:Solamar|solamar|Electron)\/\S+/g, '')

// Windows groups taskbar buttons, and shows notifications, by AppUserModelID. One id for the whole process, the
// same the window sets (browser.ts), so Chromium's own windows (picture in picture) join Solamar's taskbar button.
// The installer registers the packaged id with its Start menu shortcut; dev builds register theirs below.
const APP_ID = app.isPackaged ? 'app.solamar.browser' : 'app.solamar.browser.dev'
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID)
  if (!app.isPackaged && process.env.SOLAMAR_HIDDEN !== '1') devShortcut()
}

/**
 * Dev builds run as electron.exe, whose icon Windows would show for anything it cannot tie to Solamar. A Start menu
 * shortcut carrying Solamar's app id and icon gives the id a name, an icon and permission to show notifications,
 * as the installer does for the packaged app. Written once, rewritten only when it points somewhere else.
 */
function devShortcut(): void {
  try {
    const root = join(__dirname, '..', '..')
    const programs = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    try {
      unlinkSync(join(programs, `${OLD_NAME} (dev).lnk`)) // left from the working name
    } catch {}
    const link = join(programs, 'Solamar (dev).lnk')
    const want = { target: process.execPath, args: `"${root}"`, cwd: root, icon: join(root, 'build', 'icon.ico'), iconIndex: 0, appUserModelId: APP_ID, description: 'Solamar (development build)' }
    let have: Electron.ShortcutDetails | null = null
    try {
      have = shell.readShortcutLink(link)
    } catch {}
    if (have && have.target === want.target && have.args === want.args && have.appUserModelId === want.appUserModelId) return
    shell.writeShortcutLink(link, have ? 'replace' : 'create', want)
  } catch (err) {
    console.error('[solamar] dev shortcut', err)
  }
}
// macOS gives apps started from the Finder or the Dock a bare PATH (/usr/bin:/bin:...), so `claude` and other tools
// installed with Homebrew, npm or Claude Code's own installer would not be found.
if (process.platform === 'darwin') {
  const home = app.getPath('home')
  const have = (process.env.PATH ?? '').split(':').filter(Boolean)
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(home, '.npm-global', 'bin')]
  process.env.PATH = [...have, ...extra.filter((d) => !have.includes(d))].join(':')
}

/**
 * macOS needs an app menu: without one Command+C, Command+V, Command+Q and the rest do nothing. It holds only the
 * system items; Solamar's own shortcuts (Command+T and so on) are handled in browser.ts like on Windows.
 */
function macMenu(): Menu {
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
  ])
}

if (process.env.SOLAMAR_USER_DATA) app.setPath('userData', process.env.SOLAMAR_USER_DATA)
else moveOldProfile()

if (!app.requestSingleInstanceLock()) app.quit()
else start()

function urlsFrom(argv: string[]): string[] {
  return argv.filter((a) => /^https?:\/\//i.test(a))
}

function start(): void {
  let browser: Browser | null = null
  const store = new Store(settingsFile(app.getPath('userData')))
  const adblock = new AdBlock()
  const secrets = new Secrets(join(app.getPath('userData'), 'secrets.json'))
  const vault = new Vault(join(app.getPath('userData'), 'passwords.json'))

  // macOS hands links to the default browser as events, not as command-line arguments; they can come before the window.
  const early: string[] = []
  app.on('open-url', (e, url) => {
    e.preventDefault()
    if (!/^https?:\/\//i.test(url)) return
    if (browser) browser.openTab(url)
    else early.push(url)
  })

  app.on('second-instance', (_e, argv) => {
    if (!browser) return
    for (const u of urlsFrom(argv)) browser.openTab(u)
    if (browser.win.isMinimized()) browser.win.restore()
    browser.win.focus()
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null)
    await secrets.init()
    await vault.init()
    browser = new Browser(store, adblock, secrets, vault)
    browser.updates.start()
    if (!store.doc.settings.clipsDir) moveOldClips(browser.clipsRoot())
    browser.agent.sync()
    for (const u of [...urlsFrom(process.argv), ...early]) browser.openTab(u)
    registerIpc(browser, store, adblock)
    void adblock
      .init(join(app.getPath('userData'), 'adblock-engine.bin'), store.doc.settings.adblock.enabled, store.doc.settings.adblock.allowlist)
      .then(() => browser?.refresh())
    browser.win.on('close', () => browser?.saveSessions(true))
    browser.win.on('closed', () => {
      store.flush()
      app.quit()
    })
  })

  app.on('before-quit', () => {
    browser?.saveSessions(true)
    store.flush()
  })
  app.on('window-all-closed', () => app.quit())
}

type Api = Record<string, (...args: any[]) => unknown>

function registerIpc(b: Browser, store: Store, adblock: AdBlock): void {
  let arcPath: string | null = null
  let sources: ImportSource[] = []
  const str = (v: unknown, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : '')
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const section = (v: unknown): Section => (v === 'favorites' || v === 'pinned' || v === 'today' ? v : 'today')

  const api: Api = {
    state: () => b.snapshot(),
    systemDark: () => nativeTheme.shouldUseDarkColors,

    openTab: (url) => b.openTab(str(url)),
    activate: (id) => b.activate(str(id)),
    closeTab: (id) => b.closeTab(str(id)),
    nav: (action) => ['back', 'forward', 'reload', 'stop'].includes(action) && b.nav(action),
    run: (cmd) => b.run(cmd),
    runAction: (id) => b.runAction(str(id)),

    moveItem: (id, to) => b.moveItem(str(id), { section: section(to?.section), parentId: to?.parentId ? str(to.parentId) : null, index: num(to?.index), spaceId: to?.spaceId ? str(to.spaceId) : undefined }),
    createFolder: (sec, parentId) => b.createFolder(section(sec ?? 'pinned'), parentId ? str(parentId) : null),
    rename: (id, title) => b.rename(str(id), str(title, 200)),
    toggleFolder: (id) => b.toggleFolder(str(id)),
    itemMenu: (id) => b.itemMenu(str(id)),
    spaceMenu: (id) => b.spaceMenu(str(id)),
    unsplit: () => b.unsplit(),

    switchSpace: (id) => b.switchSpace(str(id)),
    createSpace: (input) => b.createSpace({ title: str(input?.title, 40), icon: isSpaceIcon(input?.icon) ? input.icon : 'circle', theme: theme(input?.theme) }),
    updateSpace: (id, patch) =>
      b.updateSpace(str(id), {
        title: patch?.title !== undefined ? str(patch.title, 40) : undefined,
        icon: isSpaceIcon(patch?.icon) ? patch.icon : undefined,
        theme: patch?.theme ? theme(patch.theme) : undefined
      }),

    openOverlay: (kind, payload) => b.openOverlay(kind, payload),
    closeOverlay: () => b.closeOverlay(),
    query: (text) => b.query(str(text, 500)),
    pick: (r, inPlace) => b.pick(r, !!inPlace),

    listArchive: (q) => b.listArchive(str(q, 200)),
    listHistory: (q) => b.listHistory(str(q, 200)),
    deleteHistory: (url) => b.deleteHistory(str(url, 4000)),
    clearBrowsingData: (what) => (what === 'history' || what === 'site-data') && b.clearBrowsingData(what),
    downloadAction: (id, action) => ['open', 'show', 'cancel', 'pause', 'resume', 'retry', 'remove'].includes(action) && b.downloadAction(str(id), action),
    clearDownloads: () => b.clearDownloads(),
    restoreArchived: (id) => b.restoreArchived(str(id)),

    updateSettings: (patch: Partial<Settings>) => {
      const s = store.doc.settings
      if (patch.searchEngine) s.searchEngine = patch.searchEngine
      if (patch.archiveAfterHours !== undefined) s.archiveAfterHours = Math.max(0, Math.min(24 * 30, num(patch.archiveAfterHours)))
      if (patch.sleepAfterMinutes !== undefined) s.sleepAfterMinutes = Math.max(0, Math.min(24 * 60, num(patch.sleepAfterMinutes)))
      if (patch.sidebarWidth !== undefined) s.sidebarWidth = Math.max(200, Math.min(420, num(patch.sidebarWidth)))
      if (patch.onboarded !== undefined) s.onboarded = !!patch.onboarded
      if (patch.layout === 'bar' || patch.layout === 'sidebar') s.layout = patch.layout
      if (typeof patch.clipsDir === 'string' && (patch.clipsDir === '' || isAbsolute(patch.clipsDir))) s.clipsDir = str(patch.clipsDir, 500)
      if (patch.peekFromPinned !== undefined) s.peekFromPinned = !!patch.peekFromPinned
      if (patch.passwords) {
        if (patch.passwords.offer !== undefined) s.passwords.offer = !!patch.passwords.offer
        if (Array.isArray(patch.passwords.never)) s.passwords.never = patch.passwords.never.map((d) => str(d, 200).toLowerCase()).filter(Boolean)
        if ([0, 5, 15, 60].includes(patch.passwords.lockAfter)) s.passwords.lockAfter = patch.passwords.lockAfter
      }
      if (patch.autoPip !== undefined) s.autoPip = !!patch.autoPip
      if (patch.appIcon && APP_ICONS.some((i) => i.id === patch.appIcon) && patch.appIcon !== s.appIcon) {
        s.appIcon = patch.appIcon
        b.applyAppIcon()
      }
      if (patch.adblock) {
        if (patch.adblock.enabled !== undefined && patch.adblock.enabled !== s.adblock.enabled) {
          s.adblock.enabled = !!patch.adblock.enabled
          adblock.setEnabled(s.adblock.enabled)
        }
        if (Array.isArray(patch.adblock.allowlist)) {
          s.adblock.allowlist = patch.adblock.allowlist.map((d) => str(d, 200).toLowerCase().trim()).filter(Boolean)
          adblock.setAllowlist(s.adblock.allowlist)
        }
      }
      if (patch.ai) {
        const engine = (v: unknown) => (v === 'ollama' || v === 'anthropic' || v === 'claude-code' ? v : undefined)
        if (patch.ai.enabled !== undefined) s.ai.enabled = !!patch.ai.enabled
        if (patch.ai.model !== undefined) s.ai.model = str(patch.ai.model, 200)
        if (patch.ai.host !== undefined) s.ai.host = str(patch.ai.host, 200)
        if (engine(patch.ai.engine)) s.ai.engine = engine(patch.ai.engine)!
        if (patch.ai.anthropicModel && ANTHROPIC_MODELS.some((m) => m.id === patch.ai!.anthropicModel)) s.ai.anthropicModel = patch.ai.anthropicModel
        if (patch.ai.claudeCodeModel !== undefined && ['', 'opus', 'sonnet', 'haiku'].includes(patch.ai.claudeCodeModel)) s.ai.claudeCodeModel = patch.ai.claudeCodeModel
        if (patch.ai.features) {
          for (const [f, v] of Object.entries(patch.ai.features)) {
            if (!AI_FEATURES.some((x) => x.id === f)) continue
            if (engine(v)) s.ai.features[f as AiFeature] = engine(v)
            else delete s.ai.features[f as AiFeature]
          }
        }
        if (s.ai.enabled) void b.aiStatus()
      }
      if (patch.agent) {
        if (patch.agent.mcpEnabled !== undefined) s.agent.mcpEnabled = !!patch.agent.mcpEnabled
        if (patch.agent.allTabs !== undefined) s.agent.allTabs = !!patch.agent.allTabs
        if (patch.agent.siteAccess === 'all' || patch.agent.siteAccess === 'ask') s.agent.siteAccess = patch.agent.siteAccess
        if (patch.agent.approvals === 'auto' || patch.agent.approvals === 'ask') s.agent.approvals = patch.agent.approvals
        if (patch.agent.port !== undefined) s.agent.port = Math.max(1024, Math.min(65535, Math.round(num(patch.agent.port)))) || 47821
        if (patch.agent.grants) {
          for (const [site, g] of Object.entries(patch.agent.grants)) {
            const key = str(site, 200).toLowerCase()
            if (g === 'allow' || g === 'block') s.agent.grants[key] = g
            else delete s.agent.grants[key]
          }
        }
        b.agent.sync()
      }
      if (patch.shortcuts) {
        for (const [k, v] of Object.entries(patch.shortcuts)) if (k in s.shortcuts) (s.shortcuts as any)[k] = normalizeAccelerator(str(v, 40))
      }
      store.save()
      b.refresh()
      return true
    },
    suspendShortcuts: (on) => b.setShortcutsSuspended(!!on),
    setSidebarWidth: (w) => b.setSidebarWidth(num(w)),
    allowSite: (site) => b.toggleAllowSite(str(site, 200)),

    arcScan: () => {
      arcPath = locateArcSidebar()
      if (!arcPath) return { found: false }
      try {
        return { found: true, preview: previewPlan(arcPath, readArcPlan(arcPath)) }
      } catch (err) {
        return { found: true, error: err instanceof ArcFormatError ? err.message : 'Could not read Arc data: ' + (err as Error).message }
      }
    },
    arcImport: (opts) => {
      if (!arcPath) return { error: 'Scan for Arc first.' }
      try {
        const summary = applyArcPlan(store.doc, readArcPlan(arcPath), { includeToday: !!opts?.includeToday })
        store.doc.settings.onboarded = true
        store.save()
        b.refresh()
        b.switchSpace(store.doc.spaces[store.doc.spaces.length - summary.spaces]?.id ?? store.doc.window.focusedSpaceId)
        return { summary }
      } catch (err) {
        return { error: (err as Error).message }
      }
    },

    browserSources: () => {
      sources = listSources()
      return sources.map((s, i) => ({ i, browser: s.browser, browserName: s.browserName, profileName: s.profileName, isDefault: s.isDefault, has: s.has, needsPermission: s.needsPermission }))
    },
    browserImport: async (i, opts) => {
      const src = sources[num(i)]
      if (!src) return { error: 'Pick a browser first.' }
      try {
        const data = await readSource(src, { bookmarks: !!opts?.bookmarks, history: !!opts?.history })
        const r = applyImport(store.doc, data, { bookmarks: !!opts?.bookmarks, history: !!opts?.history })
        store.doc.settings.onboarded = true
        store.save()
        b.refresh()
        if (r.spaceId) b.switchSpace(r.spaceId)
        return { ...r, warnings: data.warnings }
      } catch (err) {
        return { error: 'Could not import: ' + (err as Error).message }
      }
    },

    aiStatus: () => b.aiStatus(),
    dismissCrashNotice: () => b.dismissCrashNotice(),
    aiWriteStart: () => b.aiWriteStart(),
    aiWriteRun: (action, instruction) =>
      ['fix', 'clearer', 'shorter', 'formal', 'friendly', 'english', 'polish', 'custom', 'reply'].includes(action) && b.aiWriteRun(action, str(instruction, 2000)),
    aiWriteApply: (edited) => b.aiWriteApply(typeof edited === 'string' ? str(edited, 40000) : undefined),
    aiRewrite: (q) => b.aiRewrite(str(q, 500)),
    aiAnswer: (q) => b.aiAnswer(str(q, 2000)),
    aiAnswerClear: () => b.aiAnswerClear(),
    setAnthropicKey: (key) => b.setAnthropicKey(key ? str(key, 400).trim() : null),
    agentDecide: (id, answer) => ['once', 'always', 'block', 'allow', 'deny'].includes(answer) && b.agent.decide(str(id), answer),
    agentPause: (on) => b.agent.setPaused(!!on),
    permissionDecide: (id, answer) => ['allow', 'block', 'dismiss'].includes(answer) && b.decidePermission(str(id), answer),
    forgetPermission: (key) => {
      delete store.doc.settings.sitePermissions[str(key, 300)]
      store.save()
      b.refresh()
    },
    claudeCliCheck: () => b.agent.cliCheck(),
    claudeCliConnect: () => b.agent.cliConnect(),
    claudeCliLogin: () => b.agent.cliLogin(),
    copyText: (t) => clipboard.writeText(str(t, 2000)),
    setShared: (id, on) => b.setShared(str(id), !!on),
    aiAsk: (q) => b.aiAsk(str(q, 2000)),
    aiSummarize: () => b.aiSummarize(),
    aiTidy: () => b.aiTidy(),
    applyTidy: () => b.applyTidy(),
    aiCancel: () => b.aiCancel(),
    aiClear: () => b.aiClear(),
    aiPanel: (open) => {
      if (!!open !== b.ai.panelOpen) b.run('aiPanel')
    },

    saveForClaude: () => b.saveForClaude(),
    dismissNotice: () => b.dismissNotice(),
    updateCheck: () => b.updates.check(),
    updateInstall: () => b.updates.install(),
    updateOpenRelease: () => {
      b.dismissNotice()
      b.openTab(RELEASES_URL)
    },
    openClipFolder: (path) => b.openClipFolder(str(path, 1000)),
    chooseClipsDir: () => b.chooseClipsDir(),
    resetClipsDir: () => {
      store.doc.settings.clipsDir = ''
      store.save()
      b.refresh()
    },
    extensionDecide: (id, ok) => b.decideExtensionInstall(str(id), !!ok),
    // Extension ids are 32 letters a-p; anything else could walk out of the extensions folder.
    extensionRemove: (id) => typeof id === 'string' && /^[a-p]{32}$/.test(id) && b.uninstallExtension(id),
    agentRun: (task) => b.agentRun(str(task, 4000)),
    agentStop: () => b.agentStop(),
    agentClear: () => b.agentClear(),
    savePasswordDecide: (answer) => ['save', 'never', 'dismiss'].includes(answer) && b.decideSavePassword(answer),
    passwordsList: (q) => b.vault.list(str(q, 200)),
    // Showing or copying a password first confirms it is you (Windows Hello / Touch ID, or the master password).
    passwordReveal: (id, master) => b.revealPassword(str(id), master ? str(master, 1000) : undefined),
    passwordCopy: async (id, field, master) => {
      if (field === 'username') {
        const meta = b.vault.info(str(id))
        if (meta) clipboard.writeText(meta.username)
        return { ok: !!meta }
      }
      if (field !== 'password') return { ok: false }
      const r = await b.revealPassword(str(id), master ? str(master, 1000) : undefined)
      if (!('password' in r)) return r
      const v = r.password
      clipboard.writeText(v)
      // A copied password does not linger on the clipboard.
      setTimeout(async () => (await clipboard.readText()) === v && clipboard.clear(), 30_000).unref()
      return { ok: true }
    },
    vaultUnlock: (password) => b.vaultUnlock(str(password, 1000)),
    vaultLock: () => b.vaultLock(),
    vaultSetMaster: async (password, current) => {
      try {
        if (b.vault.hasMaster && b.vault.locked && !(current && (await b.vaultUnlock(str(current, 1000))))) return { error: 'Type your current master password first.' }
        if (b.vault.hasMaster && current && !(await b.vault.verifyMaster(str(current, 1000)))) return { error: 'That is not your current master password.' }
        await b.vault.setMaster(str(password, 1000))
        b.refresh()
        return { ok: true }
      } catch (err) {
        return { error: (err as Error).message }
      }
    },
    vaultRemoveMaster: async (current) => {
      const ok = await b.vault.removeMaster(str(current, 1000))
      b.refresh()
      return ok ? { ok: true } : { error: 'That is not your master password.' }
    },
    passwordDelete: async (id) => {
      await b.vault.remove(str(id))
      b.refresh()
    },
    passwordUpdate: async (id, p) => {
      try {
        const ok = await b.vault.update(str(id), { username: p?.username !== undefined ? str(p.username, 300) : undefined, password: p?.password ? str(p.password, 1000) : undefined })
        b.refresh()
        return ok
      } catch (err) {
        if (err instanceof VaultLockedError) return false
        throw err
      }
    },
    passwordsImportCsv: async (text) => {
      try {
        const parsed = parsePasswordsCsv(str(text, 20_000_000))
        const r = await b.vault.importEntries(parsed.entries)
        b.refresh()
        return { format: parsed.format, skipped: parsed.skipped, ...r }
      } catch (err) {
        return { error: (err as Error).message }
      }
    },
    openBoost: () => b.openBoost(),
    closeBoost: () => b.closeBoost(),
    updateBoost: (id, p) =>
      b.updateBoost(str(id), {
        css: p?.css !== undefined ? str(p.css, 100_000) : undefined,
        js: p?.js !== undefined ? str(p.js, 100_000) : undefined,
        enabled: p?.enabled !== undefined ? !!p.enabled : undefined,
        zaps: Array.isArray(p?.zaps) ? p.zaps.map((z: unknown) => str(z, 500)).filter(Boolean).slice(0, 300) : undefined,
        font: typeof p?.font === 'string' && BOOST_FONTS.some((f) => f.id === p.font) ? p.font : undefined,
        filter: ['none', 'dark', 'sepia', 'gray'].includes(p?.filter) ? p.filter : undefined,
        hue: p?.hue !== undefined ? Math.max(0, Math.min(359, Math.round(num(p.hue)))) : undefined
      }),
    deleteBoost: (id) => b.deleteBoost(str(id)),
    startZap: () => b.startZap(),
    stopZap: () => b.stopZap(),
    reloadActive: () => b.run('reload'),
    promotePeek: (split) => b.promotePeek(!!split),
    openPeek: (url) => b.openPeek(str(url)),
    mediaAction: (a) => ['toggle', 'pip', 'mute', 'close'].includes(a) && b.mediaAction(a),

    openExternal: (url) => b.openExternal(str(url)),
    windowDrag: (phase, x, y) => ['start', 'move', 'end'].includes(phase) && b.windowDrag(phase, num(x), num(y)),
    windowControl: (action) => {
      if (action === 'minimize') b.win.minimize()
      else if (action === 'maximize') b.win.isMaximized() ? b.win.unmaximize() : b.win.maximize()
      else if (action === 'close') b.quit()
    }
  }

  // From the page preload (web pages, not Solamar's UI): may this link click open in Peek? Answered synchronously
  // so the page's own navigation can be cancelled. Only a URL comes in; Solamar decides from the sender's tab.
  ipcMain.on('solamar:peek-link', (e, url: unknown) => {
    e.returnValue = typeof url === 'string' && url.length < 4096 && !b.isOwnWebContents(e.sender) ? b.peekLink(e.sender, url) : false
  })

  // Passwords, from the page preload. The origin is the sending frame's own, never one the page names.
  ipcMain.on('solamar:login-submit', (e, d: { username?: unknown; password?: unknown }) => {
    if (b.isOwnWebContents(e.sender)) return
    b.loginSubmitted(e.sender, e.senderFrame?.url ?? '', str(d?.username, 300), str(d?.password, 1000))
  })
  ipcMain.on('solamar:login-done', (e) => !b.isOwnWebContents(e.sender) && b.loginDone(e.sender))
  ipcMain.handle('solamar:logins', (e) => (b.isOwnWebContents(e.sender) ? [] : b.loginsFor(e.sender, e.senderFrame?.url ?? '')))
  ipcMain.handle('solamar:login-fill', (e, id: unknown) => (b.isOwnWebContents(e.sender) ? null : b.loginFill(e.sender, e.senderFrame?.url ?? '', str(id))))

  ipcMain.handle('solamar:call', (e: IpcMainInvokeEvent, method: string, ...args: unknown[]) => {
    if (!b.isOwnWebContents(e.sender)) throw new Error('not allowed')
    const fn = Object.prototype.hasOwnProperty.call(api, method) ? api[method] : undefined
    if (!fn) throw new Error('unknown method ' + method)
    return fn(...args)
  })
}

function theme(t: any): SpaceTheme {
  const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d)
  return {
    color: hex(t?.color, '#7c6cf2'),
    color2: t?.color2 ? hex(t.color2, '#c58af5') : undefined,
    mode: t?.mode === 'light' || t?.mode === 'dark' ? t.mode : 'auto',
    texture: t?.texture === 'grain' || t?.texture === 'dots' ? t.texture : 'none',
    intensity: typeof t?.intensity === 'number' ? Math.max(0, Math.min(1, t.intensity)) : 0.7
  }
}
