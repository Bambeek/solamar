// Hard-kill Solamar mid-session, start it again: crash notice, back/forward history and typed form text come back.
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const srv = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' })
  r.end(q.url === '/two' ? '<title>Two</title>page two' : '<title>One</title><input id=f name=f><a id=go href="/two">next</a>')
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
const launch = () => electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const pageOf = async (app, pred) => { for (let i = 0; i < 100; i++) { const p = app.windows().find(pred); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } throw new Error('no page') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

let app = await launch()
let ui = await pageOf(app, (w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
let call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true })
await call('openTab', base + '/one')
const one = await pageOf(app, (w) => w.url().endsWith('/one'))
await one.waitForLoadState('load')
await one.fill('#f', 'typed before the crash')
await one.click('#go')
await pageOf(app, (w) => w.url().endsWith('/two'))
await sleep(16500) // the 15 s session save
// Kill the whole tree so no child keeps the single-instance lock, like a real crash once Windows has cleaned up.
execSync(`taskkill /pid ${app.process().pid} /T /F`, { stdio: 'ignore' })
await sleep(2500)

app = await launch()
ui = await pageOf(app, (w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await sleep(1500)
let s = await call('state')
check('crash notice shows after a hard kill', s.restoredAfterCrash === true)
const rt = s.runtime[s.activeId]
check('tab comes back with its back history', rt?.canGoBack === true, JSON.stringify(rt && { canGoBack: rt.canGoBack }))
await call('nav', 'back')
const back = await pageOf(app, (w) => w.url().endsWith('/one'))
await back.waitForLoadState('load')
await sleep(500)
const val = await back.evaluate(() => document.getElementById('f').value)
check('typed form text is restored', val === 'typed before the crash', JSON.stringify(val))
await call('dismissCrashNotice')
await app.close()
app = await launch()
ui = await pageOf(app, (w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
s = await ui.evaluate(() => window.solamar.call('state'))
check('no crash notice after a clean quit', s.restoredAfterCrash === false)
await app.close(); srv.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
