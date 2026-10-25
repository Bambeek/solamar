// The updater in the packaged app (dist/win-unpacked, built with `npm run dist`): a local feed claims version 0.1.1
// and serves the freshly built installer under it, the way a GitHub release would. The app must find it, download it,
// check its sha512 and say it is ready, with a "Restart now" notice. Nothing is installed.
// Usage: node tests/e2e/updates.mjs <userDataDir>
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const [userData] = process.argv.slice(2)
const installer = 'dist/Solamar-Setup.exe'
if (!existsSync(installer)) throw new Error('Build first: npm run dist')
const sha512 = createHash('sha512').update(readFileSync(installer)).digest('base64')
const size = statSync(installer).size
const feed = `version: 0.1.1
files:
  - url: Solamar-Setup.exe
    sha512: ${sha512}
    size: ${size}
path: Solamar-Setup.exe
sha512: ${sha512}
releaseDate: '2026-10-25T00:00:00.000Z'
`
const asked = []
const server = createServer((q, r) => {
  asked.push(q.url)
  if (q.url.startsWith('/latest.yml')) return r.writeHead(200, { 'content-type': 'text/yaml' }), r.end(feed)
  if (q.url.startsWith('/Solamar-Setup.exe') && !q.url.includes('blockmap')) {
    r.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size })
    return createReadStream(installer).pipe(r)
  }
  r.writeHead(404)
  r.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

const app = await electron.launch({
  executablePath: 'dist/win-unpacked/Solamar.exe',
  args: ['--mute-audio'],
  env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, SOLAMAR_UPDATE_URL: `http://127.0.0.1:${server.address().port}/` }
})
let ui
for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true })
let s = await call('state')
check('the packaged app has the updater on', s.update?.status !== 'off' && s.update?.version === '0.1.0', JSON.stringify(s.update))
await call('updateCheck')
for (let i = 0; i < 240; i++) {
  s = await call('state')
  if (s.update?.status === 'ready' || s.update?.status === 'error') break
  await sleep(250)
}
check('it finds 0.1.1, downloads it and checks it', s.update?.status === 'ready' && s.update.next === '0.1.1', JSON.stringify(s.update))
check('it asked the feed, then fetched the installer', asked.some((u) => u.startsWith('/latest.yml')) && asked.some((u) => u === '/Solamar-Setup.exe'), asked.join(' '))
check('a notice offers to restart now', s.notice?.text.includes('0.1.1') && s.notice?.action?.call === 'updateInstall', JSON.stringify(s.notice))
await call('openOverlay', 'settings', { tab: 'about' })
const ov = app.windows().find((w) => w.url().endsWith('#overlay'))
await sleep(500)
check('Settings > About says it is ready, with a button', /0\.1\.1 is downloaded/.test(await ov.locator('.set-update').innerText()) && (await ov.locator('.set-update button', { hasText: 'Restart and update' }).count()) === 1)

await app.close()
server.close()
// The downloaded installer waits in the updater's cache; this test's copy goes.
rmSync(join(process.env.LOCALAPPDATA ?? '', 'solamar-updater'), { recursive: true, force: true })
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
