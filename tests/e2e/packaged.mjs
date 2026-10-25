// Starts the packaged app (dist/win-unpacked, or dist/mac*/Solamar.app) hidden with a throwaway profile and loads a page.
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const site = createServer((q, r) => (r.writeHead(200, { 'content-type': 'text/html' }), r.end('<title>Packaged OK</title>hi')))
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Where electron-builder leaves the unpacked app: Windows, macOS on Apple silicon, macOS on Intel.
const exe = { win32: 'dist/win-unpacked/Solamar.exe', darwin: process.arch === 'arm64' ? 'dist/mac-arm64/Solamar.app/Contents/MacOS/Solamar' : 'dist/mac/Solamar.app/Contents/MacOS/Solamar' }[process.platform]
const app = await electron.launch({ executablePath: exe, args: ['--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
let ui
for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true })
await call('openTab', `http://127.0.0.1:${site.address().port}/`)
let title = ''
for (let i = 0; i < 50 && title !== 'Packaged OK'; i++) (title = (await call('state')).items.at(-1)?.title ?? ''), await sleep(200)
console.log(title === 'Packaged OK' ? 'PASS packaged app loads a page' : 'FAIL title=' + title)
const s = await call('state')
console.log(s.ai.claudeCodeAllowed ? 'PASS personal build allows the Claude Code engine' : 'INFO Claude Code engine off in this build')
console.log(s.passwords.available ? 'PASS vault available in packaged app' : 'FAIL vault unavailable')
await app.close()
site.close()
