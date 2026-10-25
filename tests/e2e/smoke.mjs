// Launches the built app with a hidden window and a throwaway profile, drives it through the UI bridge,
// and saves screenshots of each view. Usage: node tests/e2e/smoke.mjs <userDataDir> <outDir>
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'
import { startMockOllama } from './mock-ollama.mjs'

const [userData, outDir] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const log = (...a) => console.log('[smoke]', ...a)
app.process().stderr.on('data', (d) => process.stderr.write('[main] ' + d))

const byHash = async (hash) => {
  for (let i = 0; i < 50; i++) {
    const p = app.windows().find((w) => w.url().endsWith('#' + hash))
    if (p) return p
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('no page #' + hash + ' in ' + app.windows().map((w) => w.url()).join(', '))
}
const ui = await byHash('ui')
const overlay = await byHash('overlay')
await ui.waitForLoadState('domcontentloaded')
const errors = []
for (const [n, p] of [['ui', ui], ['overlay', overlay]]) {
  p.on('pageerror', (e) => (errors.push(n + ': ' + e.message), log('PAGEERROR', n, e.message)))
  p.on('console', (m) => m.type() === 'error' && log('console.error', n, m.text().slice(0, 300)))
}
const sidebarOk = async (tag) => log(tag, 'sidebar rendered', await ui.locator('.sidebar, .topbar').count())
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const state = () => call('state')

let s = await state()
log('spaces', s.spaces.length, 'items', s.items.length, 'onboarded', s.settings.onboarded)
await ui.screenshot({ path: `${outDir}/S01-welcome.png` })

// F01: command bar -> open a page
await call('run', 'newTab')
await overlay.waitForSelector('.command input')
await overlay.screenshot({ path: `${outDir}/S03-command-empty.png` })
await overlay.fill('.command input', 'example.com')
await overlay.waitForSelector('.result')
const firstResult = await overlay.textContent('.result .title')
log('first result:', firstResult)
await overlay.press('.command input', 'Enter')
await new Promise((r) => setTimeout(r, 2500))
s = await state()
const active = s.items.find((i) => i.id === s.activeId)
log('active tab', active?.url, active?.title, 'overlay', s.overlay)
const tab = app.windows().find((w) => w.url().startsWith('https://example.com'))
log('tab page found', !!tab)
if (tab) await tab.screenshot({ path: `${outDir}/tab-example.png` })

// F02: pin + folder
await call('run', 'pinTab')
const folder = await call('createFolder', 'pinned', null)
s = await state()
log('pinned', s.items.filter((i) => i.section === 'pinned').map((i) => i.kind + ':' + (i.title ?? '')))
await call('moveItem', s.activeId, { section: 'pinned', parentId: folder, index: 0 })
s = await state()
log('in folder', s.items.filter((i) => i.parentId === folder).length)

// F04: new space with theme
await call('createSpace', { title: 'Work', icon: 'briefcase', theme: { color: '#3b82f6', color2: '#22d3ee', mode: 'dark', texture: 'grain', intensity: 0.8 } })
s = await state()
log('spaces', s.spaces.map((x) => x.title), 'focused', s.spaces.find((x) => x.id === s.window.focusedSpaceId)?.title)
await call('openTab', 'https://example.org/')
await new Promise((r) => setTimeout(r, 1500))
await ui.screenshot({ path: `${outDir}/S02-sidebar-dark.png` })

// Theme editor + settings render
await call('openOverlay', 'theme', { mode: 'edit', spaceId: s.window.focusedSpaceId })
await overlay.waitForSelector('.theme-editor')
await new Promise((r) => setTimeout(r, 400))
await overlay.screenshot({ path: `${outDir}/S04-theme.png` })
await call('openOverlay', 'settings')
await overlay.waitForSelector('.settings')
await new Promise((r) => setTimeout(r, 400))
await overlay.screenshot({ path: `${outDir}/S09-settings.png` })
await call('closeOverlay')

// Arc import scan (read-only)
const scan = await call('arcScan')
log('arc scan found', scan.found, scan.error ?? '', scan.preview ? scan.preview.spaces.map((x) => `${x.icon}:${x.pinned}p/${x.today}t/${x.folders}f`).join(' ') : '')

// Ad block readiness
for (let i = 0; i < 30 && !(await state()).adblockReady; i++) await new Promise((r) => setTimeout(r, 1000))
s = await state()
log('adblock ready', s.adblockReady)

// Split view
await call('run', 'splitView')
s = await state()
log('split', s.window.split.length)
await call('unsplit')

// Sidebar hidden mode
await call('run', 'toggleSidebar')
await new Promise((r) => setTimeout(r, 300))
await ui.screenshot({ path: `${outDir}/S01-topbar.png` })
await sidebarOk('topbar')
await call('run', 'toggleSidebar')

// Keyboard: shortcuts must work while the web page has focus
const page = app.windows().find((w) => w.url().startsWith('https://example.org'))
await page.bringToFront().catch(() => {})
await page.keyboard.press('Control+T')
await new Promise((r) => setTimeout(r, 300))
log('Ctrl+T in page opens', (await state()).overlay?.kind)
await overlay.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 200))
log('Esc closes overlay', (await state()).overlay === null)
await page.keyboard.press('Alt+1')
await new Promise((r) => setTimeout(r, 200))
s = await state()
await sidebarOk('after keys')
log('Alt+1 space', s.spaces.find((x) => x.id === s.window.focusedSpaceId)?.title)

// Local AI against a mock Ollama
const mock = await startMockOllama()
await call('updateSettings', { ai: { enabled: true, host: mock.url } })
await new Promise((r) => setTimeout(r, 500))
await call('openTab', 'https://example.net/')
await new Promise((r) => setTimeout(r, 1500))
await call('openTab', 'https://example.com/a')
await call('openTab', 'https://example.com/b')
await new Promise((r) => setTimeout(r, 1000))
await sidebarOk('before ai')
await call('aiSummarize')
await sidebarOk('after summarize')
s = await state()
log('ai summary', JSON.stringify(s.ai.messages.at(-1)?.content), 'models', s.ai.models)
await call('aiTidy')
s = await state()
log('ai tidy groups', JSON.stringify(s.ai.tidy?.map((g) => [g.title, g.itemIds.length])))
await call('applyTidy')
s = await state()
log('folders after tidy', s.items.filter((i) => i.kind === 'folder' && i.section === 'today').map((f) => f.title + ':' + s.items.filter((c) => c.parentId === f.id).length))
await new Promise((r) => setTimeout(r, 300))
await ui.screenshot({ path: `${outDir}/S15-ai-panel.png` })
await call('aiPanel', false)
mock.server.close()

// Arc import into this throwaway profile (Arc's files are only read)
const imp = await call('arcImport', { includeToday: true })
s = await state()
log('arc import', JSON.stringify(imp), 'spaces now', s.spaces.length)
await new Promise((r) => setTimeout(r, 300))
await ui.screenshot({ path: `${outDir}/S11-after-arc-import.png` })

log('page errors', errors.length)
await app.close()
log('done')
