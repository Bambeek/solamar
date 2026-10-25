// macOS checks on the packaged app (run by .github/workflows/build.yml on a Mac): the app menu that makes
// Command+C/V/Q work, the traffic lights over the top bar, Command+T as the new-tab shortcut, and a screenshot of the
// whole screen with the window on it. Usage: node tests/e2e/mac.mjs <userDataDir> <screenshot.png>
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData, shot] = process.argv.slice(2)
const site = createServer((q, r) => (r.writeHead(200, { 'content-type': 'text/html' }), r.end('<title>Solamar on macOS</title><h1 style="font:40px system-ui;padding:40px">Solamar on macOS</h1>')))
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))
const exe = process.arch === 'arm64' ? 'dist/mac-arm64/Solamar.app/Contents/MacOS/Solamar' : 'dist/mac/Solamar.app/Contents/MacOS/Solamar'
// Shown, not hidden: the traffic lights only exist on a visible window.
const app = await electron.launch({ executablePath: exe, args: ['--mute-audio'], env: { ...process.env, SOLAMAR_USER_DATA: userData } })
let ui
for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true })
await call('openTab', `http://127.0.0.1:${site.address().port}/`)
await sleep(1500)

const menu = await app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((i) => ({ label: i.label, roles: (i.submenu?.items ?? []).map((s) => String(s.role ?? "").toLowerCase()) })))
const edit = menu.find((m) => m.roles.includes('copy'))
check('app menu with Copy, Paste, Select All', !!edit && ['paste', 'selectall'].every((r) => edit.roles.includes(r)), JSON.stringify(menu))
check('app menu has Quit', menu.some((m) => m.roles.includes('quit')))

const pos = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getWindowButtonPosition())
check('traffic lights centred on the top bar', JSON.stringify(await pos()) === JSON.stringify({ x: 16, y: 17 }), JSON.stringify(await pos()))
const pad = await ui.evaluate(() => getComputedStyle(document.querySelector('.bar-top')).paddingLeft)
check('the top bar leaves room for them', pad === '80px', pad)

await app.evaluate(({ webContents }, url) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL() === url)
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['meta'] })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['meta'] })
}, ui.url())
await sleep(600)
check('Command+T opens the command bar', (await call('state')).overlay?.kind === 'command')
await call('closeOverlay')

if (shot) {
  await sleep(800)
  execFileSync('screencapture', ['-x', shot])
  console.log('screenshot', shot)
}

await call('updateSettings', { layout: 'sidebar' })
await sleep(500)
check('sidebar layout moves them to the sidebar row', (await pos()).y === 15, JSON.stringify(await pos()))

await app.close()
site.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
