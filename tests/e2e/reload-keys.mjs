// F5 reloads, Ctrl+Shift+R and Ctrl+F5 reload without cache: checked from the server side.
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const hits = []
const srv = createServer((q, r) => { hits.push(q.headers['cache-control'] ?? '-'); r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'max-age=600' }); r.end('<title>r</title>hi') })
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${srv.address().port}/`
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith(h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('#ui')
await ui.waitForLoadState('domcontentloaded')
await ui.evaluate((u) => window.solamar.call('openTab', u), url)
await page(url)
await new Promise((r) => setTimeout(r, 800))
const press = (keyCode, modifiers) => app.evaluate(({ webContents }, [keyCode, modifiers, url]) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL() === url)
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}, [keyCode, modifiers, url])
for (const [k, m] of [['F5', []], ['R', ['control', 'shift']], ['F5', ['control']]]) { const n = hits.length; await press(k, m); await new Promise((r) => setTimeout(r, 900)); console.log(`${m.concat(k).join('+')}: ${hits.length > n ? 'reloaded, cache-control=' + hits.at(-1) : 'NO RELOAD'}`) }
await app.close(); srv.close()
