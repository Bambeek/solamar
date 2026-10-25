// Downloads (straight to the folder, progress, open/show), history, and the private space (no history, not saved).
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const dl = join(userData, '..', 'solamar-test-downloads')
rmSync(dl, { recursive: true, force: true }); mkdirSync(dl, { recursive: true })
const srv = createServer((q, r) => {
  if (q.url === '/file.bin') { r.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="report.bin"', 'content-length': 200000 }); return r.end(Buffer.alloc(200000, 7)) }
  r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<title>Page ${q.url}</title><a id=d href="/file.bin">get</a>`)
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, SOLAMAR_DOWNLOADS_DIR: dl } })
const page = async (pred) => { for (;;) { const p = app.windows().find(pred); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))
await call('updateSettings', { onboarded: true })
await call('openTab', base + '/one')
await sleep(1200)
const tab = await page((w) => w.url().endsWith('/one'))
await tab.evaluate(() => document.getElementById('d').click())
for (let i = 0; i < 40 && !(await call('state')).downloads.some((d) => d.state === 'completed'); i++) await sleep(150)
let s = await call('state')
const d = s.downloads[0]
check('download goes straight to the folder', d?.state === 'completed' && existsSync(join(dl, 'report.bin')) && d.received === 200000, JSON.stringify(d && { state: d.state, name: d.name }))
await tab.evaluate(() => document.getElementById('d').click())
for (let i = 0; i < 40 && (await call('state')).downloads.filter((x) => x.state === 'completed').length < 2; i++) await sleep(150)
check('second copy gets a new name', existsSync(join(dl, 'report (1).bin')))
await call('openTab', base + '/two')
await sleep(900)
const hist = await call('listHistory', '')
check('history lists visited pages, newest first', hist.length >= 2 && hist[0].url.endsWith('/two'), hist.slice(0, 2).map((h) => h.url.replace(base, '')).join(', '))
await call('deleteHistory', base + '/two')
check('a history entry can be removed', !(await call('listHistory', '')).some((h) => h.url.endsWith('/two')))
await call('run', 'privateSpace')
await call('closeOverlay')
s = await call('state')
const priv = s.spaces.find((x) => x.id === s.window.focusedSpaceId)
check('private space opens', priv?.private === true)
await call('openTab', base + '/secret')
await sleep(900)
check('private visits are not recorded', !(await call('listHistory', '')).some((h) => h.url.endsWith('/secret')))
await app.evaluate(({ app }) => app.quit())
await sleep(1500)
const saved = JSON.parse(readFileSync(join(userData, 'solamar.json'), 'utf-8'))
check('private space and its tabs are not saved', !saved.spaces.some((x) => x.private) && !saved.items.some((i) => (i.url ?? '').endsWith('/secret')) && !saved.profiles.some((p) => p.ephemeral))
srv.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
