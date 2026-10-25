// Google's sign-in page sees Firefox (header and navigator), every other site still sees Chrome. Only opens the
// page; nothing is typed into Google's form.
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const site = createServer((q, r) => (r.writeHead(200, { 'content-type': 'text/html' }), r.end('<title>local</title>ok')))
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const win = async (pred) => { for (let i = 0; i < 150; i++) { const w = app.windows().find(pred); if (w) return w; await sleep(200) } return null }
const ui = await win((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true })
await call('openTab', `http://127.0.0.1:${site.address().port}/`)
const local = await win((w) => w.url().startsWith('http://127.0.0.1'))
await local.waitForLoadState('load')
const l = await local.evaluate(() => ({ ua: navigator.userAgent, data: !!navigator.userAgentData }))
console.log(/Chrome\//.test(l.ua) && !/Firefox|Electron/.test(l.ua) && l.data ? 'PASS other sites see Chrome' : 'FAIL ' + JSON.stringify(l))
await call('openTab', 'https://accounts.google.com/')
const g = await win((w) => w.url().startsWith('https://accounts.google.com'))
await g.waitForLoadState('load').catch(() => {})
await sleep(1500)
const v = await g.evaluate(() => ({ ua: navigator.userAgent, data: navigator.userAgentData === undefined, chrome: typeof window.chrome, title: document.title, blocked: /may not be secure|Couldn.t sign you in/i.test(document.body.innerText) }))
console.log(/Firefox\/140/.test(v.ua) && v.data && v.chrome === 'undefined' ? 'PASS Google sign-in sees Firefox' : 'FAIL ' + JSON.stringify(v))
console.log(!v.blocked ? 'PASS sign-in page shows (no "may not be secure")' : 'FAIL blocked page', '-', v.title)
await app.close()
site.close()
