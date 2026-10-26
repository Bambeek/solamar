// Page loads carry the same client hints (sec-ch-ua, -mobile, -platform) as the page's own scripts, fetches and
// iframes. Electron leaves them off navigations only; EU Login ties its session to the browser's headers and signed
// people out when the two disagreed. Local server on localhost (Chromium sends hints there), no network.
// Usage: node tests/e2e/client-hints.mjs <userDataDir>
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const seen = {}
const site = createServer((q, r) => {
  const path = q.url.split('?')[0]
  seen[path] = { ua: q.headers['sec-ch-ua'], mobile: q.headers['sec-ch-ua-mobile'], platform: q.headers['sec-ch-ua-platform'] }
  r.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html' })
  if (path === '/') return r.end('<!doctype html><title>hints</title><script src="/app.js"></script><iframe src="/frame"></iframe><script>fetch("/fetch")</script>')
  r.end(path === '/frame' ? '<!doctype html><title>frame</title>' : '')
})
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const url = `http://localhost:${site.address().port}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
try {
  let ui
  for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
  await ui.waitForLoadState('domcontentloaded')
  await ui.evaluate(() => window.solamar.call('updateSettings', { onboarded: true }))
  await ui.evaluate((u) => window.solamar.call('openTab', u), url)
  for (let i = 0; i < 50 && !(seen['/'] && seen['/frame'] && seen['/fetch']); i++) await sleep(200)
  const tab = app.windows().find((w) => w.url() === url)
  const brands = await tab.evaluate(() => navigator.userAgentData.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', '))
  const sub = seen['/app.js']
  check('scripts carry client hints (Chromium itself)', !!sub?.ua, JSON.stringify(sub))
  check('the page load carries the same sec-ch-ua', !!seen['/']?.ua && seen['/'].ua === sub?.ua, JSON.stringify(seen['/']))
  check('and the same -mobile and -platform', seen['/']?.mobile === sub?.mobile && seen['/']?.platform === sub?.platform)
  check('an iframe load carries them too', seen['/frame']?.ua === sub?.ua, JSON.stringify(seen['/frame']))
  check('fetch matches', seen['/fetch']?.ua === sub?.ua)
  check('the header matches navigator.userAgentData', seen['/']?.ua === brands, brands)
} finally {
  await app.close().catch(() => {})
  site.close()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`)
process.exit(failed ? 1 : 0)
