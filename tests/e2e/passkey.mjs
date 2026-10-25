// Background ("conditional") passkey requests must not reach Windows Hello. Never calls the native API.
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const srv = createServer((_q, r) => (r.writeHead(200, { 'content-type': 'text/html' }), r.end('<!doctype html><title>login</title><input autocomplete="username webauthn">')))
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${srv.address().port}/`
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith(h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('#ui')
await ui.waitForLoadState('domcontentloaded')
await ui.evaluate((u) => window.solamar.call('openTab', u), url)
const tab = await page(url)
await tab.waitForLoadState('domcontentloaded')
const r = await tab.evaluate(async () => {
  const conditional = await PublicKeyCredential.isConditionalMediationAvailable()
  const wrapped = !/\[native code\]/.test(String(navigator.credentials.get))
  if (!wrapped) return { conditional, wrapped }
  const ctrl = new AbortController()
  let settled = 'pending'
  navigator.credentials.get({ mediation: 'conditional', signal: ctrl.signal, publicKey: { challenge: new Uint8Array(16) } }).then(() => (settled = 'resolved'), (e) => (settled = 'rejected:' + e.name))
  await new Promise((r) => setTimeout(r, 800))
  const before = settled
  ctrl.abort()
  await new Promise((r) => setTimeout(r, 50))
  return { conditional, wrapped, before, after: settled }
})
console.log(JSON.stringify(r))
const ok = r.conditional === false && r.wrapped && r.before === 'pending' && r.after === 'rejected:AbortError'
console.log(ok ? 'PASS background passkey requests stay quiet' : 'FAIL')
await app.close(); srv.close()
