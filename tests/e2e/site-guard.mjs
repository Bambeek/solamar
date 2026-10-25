// Known phishing and malware pages are stopped before they load, redirects to them too, and "Open anyway" opens the
// page after all. The lists are written into the profile as fresh caches (site-guard.ts uses those for 12 hours), so
// this needs no network: phish.test and bad.test are "listed" and mapped to a local server with *.test.
// Usage: node tests/e2e/site-guard.mjs <userDataDir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'guard-phishing.txt'), '# test list\n0.0.0.0 phish.test\n')
writeFileSync(join(userData, 'guard-malware.txt'), '# test list\n0.0.0.0 bad.test\n')

const hits = {}
const site = createServer((q, r) => {
  const host = (q.headers.host ?? '').split(':')[0]
  hits[host] = (hits[host] ?? 0) + 1
  if (q.url === '/go-bad') return r.writeHead(302, { location: `http://bad.test:${port}/` }), r.end()
  r.writeHead(200, { 'content-type': 'text/html' })
  r.end(`<!doctype html><title>page on ${host}</title><p>${host}</p>`)
})
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const port = site.address().port
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

const app = await electron.launch({
  args: ['.', '--mute-audio', '--host-resolver-rules=MAP *.test 127.0.0.1'],
  env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData }
})
try {
  let ui
  for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
  await ui.waitForLoadState('domcontentloaded')
  const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
  await call('updateSettings', { onboarded: true })
  const titles = () => app.windows().map((w) => w.url())
  const notice = async () => (await call('state')).notice

  await call('openTab', `http://ok.test:${port}/`)
  for (let i = 0; i < 30 && !hits['ok.test']; i++) await sleep(200)
  check('an ordinary site loads', hits['ok.test'] >= 1)

  await call('openTab', `http://phish.test:${port}/login`)
  let n
  for (let i = 0; i < 30 && !(n = await notice())?.action; i++) await sleep(200)
  await sleep(800)
  const onPhish = () => app.windows().some((w) => w.url().startsWith('http://phish.test'))
  check('a listed phishing page is stopped (never shown in a tab)', !onPhish(), JSON.stringify({ hits, urls: titles() }))
  check('the notice names the site and the danger', /phish\.test/.test(n?.text ?? '') && /passwords/.test(n?.text ?? ''), n?.text)
  check('the notice offers Open anyway', n?.action?.label === 'Open anyway' && n?.action?.call === 'siteGuardOpenAnyway')

  await call('siteGuardOpenAnyway')
  let opened = false
  for (let i = 0; i < 30 && !(opened = onPhish()); i++) await sleep(200)
  check('Open anyway opens the page after all', opened, JSON.stringify({ hits, urls: titles() }))
  check('the notice goes away', !(await notice()))

  await call('openTab', `http://ok.test:${port}/go-bad`)
  for (let i = 0; i < 30 && !(n = await notice())?.action; i++) await sleep(200)
  await sleep(800)
  check('a redirect to a malware site is stopped', !(hits['bad.test'] > 0) && !app.windows().some((w) => w.url().startsWith('http://bad.test')), JSON.stringify(hits))
  check('the notice says malware', /bad\.test/.test(n?.text ?? '') && /malware/.test(n?.text ?? ''), n?.text)
} finally {
  await app.close().catch(() => {})
  site.close()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`)
process.exit(failed ? 1 : 0)
