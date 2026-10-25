// Chrome extensions: a local test extension (tests/fixtures/extension) loaded into the default profile. Checks the
// content script, the service worker with chrome.tabs (query, create, remove), the toolbar button, that sleeping a
// pinned tab does not close it through the extension layer, private spaces without extensions, and removal.
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const extPath = resolve('tests/fixtures/extension')

const site = createServer((q, r) => (r.writeHead(200, { 'content-type': 'text/html' }), r.end(`<title>${q.url}</title><p>${q.url}</p>`)))
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${site.address().port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))
const until = async (fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) {
    const v = await fn().catch(() => null)
    if (v) return v
    await sleep(100)
  }
  return null
}

const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const pageOf = (pred) => until(async () => app.windows().find(pred))
const ui = await pageOf((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const state = () => call('state')
await call('updateSettings', { onboarded: true })

await call('openTab', base + '/first') // sets up the profile's session
await pageOf((w) => w.url() === base + '/first')
const loaded = await app.evaluate(async ({ session }, p) => {
  const ext = await session.fromPartition('persist:solamar-default').extensions.loadExtension(p)
  return { id: ext.id, name: ext.name }
}, extPath)
check('test extension loads into the profile', loaded.name === 'Solamar Test Extension')
let s = await until(async () => ((await state()).extensions.length ? state() : null))
check('state lists it for the active profile', s?.extensions[0]?.name === 'Solamar Test Extension', JSON.stringify(s?.extensions))

await call('openTab', base + '/page')
const page = await pageOf((w) => w.url() === base + '/page')
await page.waitForLoadState('load')
const content = await until(async () => page.evaluate(() => document.documentElement.dataset.solamarExt))
check('content script runs on the page', content === 'content')
const active = await until(async () => page.evaluate(() => document.documentElement.dataset.activeUrl))
check('chrome.tabs.query sees the active tab', active === base + '/page', active)
check('messages carry the sender tab', (await page.evaluate(() => document.documentElement.dataset.fromTab)) === base + '/page')

const actions = await until(async () => ui.evaluate(() => document.querySelector('browser-action-list')?.shadowRoot?.querySelectorAll('button, .action').length || 0))
check('the toolbar shows the extension button', actions >= 1, String(actions))

const before = (await state()).items.length
await page.evaluate((u) => window.postMessage({ solamarTest: { q: 'open', url: u } }, '*'), base + '/created')
s = await until(async () => {
  const st = await state()
  return st.items.some((i) => i.url === base + '/created') ? st : null
})
check('chrome.tabs.create opens a Solamar tab', !!s && s.items.length === before + 1)
const created = await pageOf((w) => w.url() === base + '/created')
await created.waitForLoadState('load')
await until(async () => created.evaluate(() => document.documentElement.dataset.solamarExt))
await created.evaluate(() => window.postMessage({ solamarTest: { q: 'close' } }, '*'))
s = await until(async () => {
  const st = await state()
  return !st.items.some((i) => i.url === base + '/created') ? st : null
})
check('chrome.tabs.remove closes it', !!s)

// A pinned tab that is closed only sleeps; the extension layer must not turn that into a real close.
await call('activate', s.items.find((i) => i.url === base + '/page').id)
await call('run', 'pinTab')
const pinnedId = (await state()).activeId
await call('closeTab', pinnedId)
await sleep(800)
s = await state()
check('sleeping a pinned tab keeps it in the sidebar', s.items.some((i) => i.id === pinnedId) && !s.runtime[pinnedId], JSON.stringify(s.runtime[pinnedId] ?? null))

await call('run', 'privateSpace')
await call('openTab', base + '/private')
const priv = await pageOf((w) => w.url() === base + '/private')
await priv.waitForLoadState('load')
await sleep(800)
check('private spaces run without extensions', !(await priv.evaluate(() => document.documentElement.dataset.solamarExt)) && (await state()).extensions.length === 0)

const ok = await call('extensionRemove', '../../evil')
check('removal refuses ids that are not extension ids', ok === false)
s = await state()
await call('switchSpace', s.spaces.find((x) => !x.private).id)
await call('extensionRemove', loaded.id)
s = await until(async () => ((await state()).extensions.length === 0 ? state() : null))
check('Remove unloads the extension', !!s)

await app.close()
site.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
