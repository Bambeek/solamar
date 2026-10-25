// "Ads allowed on this site" must stop network blocking for the whole tab: the page's own requests and those of
// iframes from other sites. Local pages on *.test; ad.doubleclick.net is mapped to the same local server, so a
// request that gets through is counted and a blocked one never arrives. Needs the prebuilt lists (network).
// Usage: node tests/e2e/adblock-allowlist.mjs <userDataDir>
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const hits = {}
const site = createServer((q, r) => {
  const u = new URL(q.url, 'http://x')
  if (u.pathname === '/ad.js') {
    const from = u.searchParams.get('from')
    hits[from] = (hits[from] ?? 0) + 1
    return r.writeHead(200, { 'content-type': 'text/javascript' }), r.end('')
  }
  const tag = u.searchParams.get('tag') ?? 'x'
  const ad = (from) => `<script src="http://ad.doubleclick.net:${port}/ad.js?from=${from}"></script>`
  r.writeHead(200, { 'content-type': 'text/html' })
  if (u.pathname === '/frame') return r.end(`<!doctype html><title>frame</title>${ad('frame-' + tag)}`)
  r.end(`<!doctype html><title>shop ${tag}</title>${ad('page-' + tag)}<iframe src="http://other.test:${port}/frame?tag=${tag}"></iframe>`)
})
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const port = site.address().port
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

const app = await electron.launch({
  args: ['.', '--mute-audio', '--host-resolver-rules=MAP *.test 127.0.0.1, MAP ad.doubleclick.net 127.0.0.1'],
  env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData }
})
let ui
for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true, adblock: { enabled: true, allowlist: [] } })
for (let i = 0; i < 300 && !(await call('state')).adblockReady; i++) await sleep(200)
check('ad block lists loaded', (await call('state')).adblockReady)

const visit = async (url) => {
  await call('openTab', url)
  for (let i = 0; i < 50 && !app.windows().some((w) => w.url() === url); i++) await sleep(200)
  await sleep(2500)
}
const shop = (tag) => `http://shop.test:${port}/?tag=${tag}`

await visit(shop('a'))
check('blocking on: the page\'s ad request is blocked', !hits['page-a'], JSON.stringify(hits))
check('blocking on: the iframe\'s ad request is blocked', !hits['frame-a'], JSON.stringify(hits))

await call('updateSettings', { adblock: { allowlist: ['shop.test'] } })
await visit(shop('b'))
check('allowed site: its own ad request goes through', hits['page-b'] >= 1, JSON.stringify(hits))
check('allowed site: an iframe from another site goes through too', hits['frame-b'] >= 1, JSON.stringify(hits))

await visit(`http://other.test:${port}/frame?tag=c`)
check('a site not on the list stays blocked', !hits['frame-c'], JSON.stringify(hits))

await call('updateSettings', { adblock: { allowlist: [] } })
await visit(shop('d'))
check('off the list again: blocked again', !hits['page-d'] && !hits['frame-d'], JSON.stringify(hits))

await app.close()
site.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
