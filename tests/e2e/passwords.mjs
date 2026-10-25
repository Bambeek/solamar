// Password vault: offer to save after a login, fill from the list under the field, origin isolation, update,
// never, CSV import, encrypted on disk, no save for script-made submits, Show/Copy behind the OS check, and the master
// password (lock, unlock to fill, restart locked). Test credentials only, on 127.0.0.1; SOLAMAR_TEST_OS_AUTH stands in
// for Windows Hello, so no system prompt appears.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)

const form = (title) =>
  `<title>${title}</title><form method=post action=/welcome><input id=email type=email name=email autocomplete=username>` +
  '<input id=pw type=password name=pw><button id=go>Sign in</button></form>'
const srv = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' })
  if (q.url === '/welcome') return r.end('<title>Welcome</title>signed in')
  // Fills and sends itself with no user input at all.
  if (q.url === '/auto')
    return r.end(form('Auto') + "<script>onload = () => { email.value = 'script@example.test'; pw.value = 'script-pass'; document.querySelector('form').requestSubmit() }</script>")
  r.end(form('Login'))
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const port = srv.address().port
const base = `http://127.0.0.1:${port}`
const other = `http://localhost:${port}`
const USER = 'tester@example.test'
const PASS = 'test-pass-' + Math.random().toString(36).slice(2, 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))
const until = async (fn, ms = 5000) => {
  for (let t = 0; t < ms; t += 100) {
    const v = await fn().catch(() => null)
    if (v) return v
    await sleep(100)
  }
  return null
}

const launch = (osAuth) => electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, SOLAMAR_TEST_OS_AUTH: osAuth } })
let app = await launch('verified')
const pageOf = (pred) => until(async () => app.windows().find(pred))
let ui = await pageOf((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const state = () => call('state')
await call('updateSettings', { onboarded: true })

const openLogin = async (origin, nth = 0) => {
  await call('openTab', origin + '/login?n=' + nth)
  const p = await pageOf((w) => w.url() === origin + '/login?n=' + nth)
  await p.waitForLoadState('load')
  return p
}
const signIn = async (p, user, pass) => {
  await p.fill('#email', user)
  await p.fill('#pw', pass)
  await p.click('#go')
  await p.waitForURL('**/welcome')
}

check('vault is available (OS keychain)', (await state()).passwords.available === true)
let p = await openLogin(base, 1)
await signIn(p, USER, PASS)
let s = await until(async () => ((await state()).savePassword ? state() : null))
check('offers to save after a login', s?.savePassword?.site === '127.0.0.1' && s.savePassword.username === USER && !s.savePassword.update, JSON.stringify(s?.savePassword))
check('the offer is a small card', s?.overlay?.kind === 'save-password')
await call('savePasswordDecide', 'save')
s = await until(async () => ((await state()).passwords.count === 1 ? state() : null))
check('saved', !!s && !s.overlay)
const list = await call('passwordsList', '')
check('the UI list carries no passwords', list.length === 1 && !('password' in list[0]) && !JSON.stringify(list).includes(PASS))
const disk = readFileSync(join(userData, 'passwords.json'), 'utf-8')
check('passwords.json is encrypted', !disk.includes(PASS) && !disk.includes(USER))
check('solamar.json holds no password', !readFileSync(join(userData, 'solamar.json'), 'utf-8').includes(PASS))

// Fill from the list under the field.
p = await openLogin(base, 2)
await p.click('#email')
const host = await until(async () => (await p.$('solamar-logins')) && p.locator('solamar-logins').boundingBox())
check('a saved-logins list shows under the field', !!host)
if (host) {
  await p.mouse.click(host.x + 30, host.y + 20)
  const filled = await until(async () => ((await p.inputValue('#pw')) === PASS ? 'ok' : null))
  check('picking it fills username and password', filled === 'ok' && (await p.inputValue('#email')) === USER)
}
const pageSees = await p.evaluate(() => {
  const h = document.querySelector('solamar-logins')
  return h ? h.shadowRoot : 'gone'
})
check('the page cannot open the list', pageSees === null || pageSees === 'gone')
await p.click('#go')
await p.waitForURL('**/welcome')
await sleep(1200)
check('signing in with a filled login does not ask again', !(await state()).savePassword)

// Another origin gets nothing.
p = await openLogin(other, 3)
await p.click('#email')
await sleep(800)
check('another origin sees no saved logins', !(await p.$('solamar-logins')))

// New password for the same user: offer an update.
p = await openLogin(base, 4)
await signIn(p, USER, PASS + '-new')
s = await until(async () => ((await state()).savePassword ? state() : null))
check('a changed password offers an update', s?.savePassword?.update === true)
await call('savePasswordDecide', 'save')
await sleep(300)
check('update keeps one login', (await call('passwordsList', '')).length === 1)

// Script-made submit: no offer.
await call('openTab', base + '/auto')
await until(async () => app.windows().find((w) => w.url() === base + '/welcome' && w !== p))
await sleep(1500)
check('a submit made by page script is not offered', !(await state()).savePassword)

// Never for this site.
p = await openLogin(base, 6)
await signIn(p, 'second@example.test', 'second-pass')
s = await until(async () => ((await state()).savePassword ? state() : null))
await call('savePasswordDecide', 'never')
p = await openLogin(base, 7)
await signIn(p, 'third@example.test', 'third-pass')
await sleep(1500)
s = await state()
check('Never for this site stops the offers', !s.savePassword && s.settings.passwords.never.includes('127.0.0.1'), JSON.stringify({ prompt: s.savePassword, never: s.settings.passwords.never, overlay: s.overlay }))

// CSV import (Chrome's export format).
const csv = 'name,url,username,password,note\r\nex,https://example.test/login,a@example.test,"p,1",\r\nex2,https://other.example.test/,b,p2,\r\nbad,android://x,c,p3,\r\n'
const r = await call('passwordsImportCsv', csv)
check('CSV import adds logins', r.added === 2 && r.format === 'chromium', JSON.stringify(r))
const csvId = (await call('passwordsList', 'a@example.test'))[0]?.id
const revealed = await call('passwordReveal', csvId)
check('Show reveals the stored password once the OS confirms it is you', revealed?.password === 'p,1', JSON.stringify(revealed))

// Master password: lock, a locked fill asks for it in Solamar's card, and only the right one opens the vault.
const MASTER = 'master-' + Math.random().toString(36).slice(2, 10)
check('a short master password is refused', !!(await call('vaultSetMaster', 'short')).error)
check('setting a master password works', (await call('vaultSetMaster', MASTER)).ok === true)
await call('vaultLock')
s = await state()
check('Lock now locks the vault, the list stays', s.passwords.master && s.passwords.locked && (await call('passwordsList', '')).length === 3)
check('a locked vault shows nothing', (await call('passwordReveal', csvId))?.error === 'locked')
p = await openLogin(base, 8)
await p.click('#email')
const host2 = await until(async () => (await p.$('solamar-logins')) && p.locator('solamar-logins').boundingBox())
if (host2) await p.mouse.click(host2.x + 30, host2.y + 20)
s = await until(async () => ((await state()).overlay?.kind === 'vault-unlock' ? state() : null))
check('picking a login while locked opens the unlock card', s?.overlay?.kind === 'vault-unlock' && s.overlay.payload?.text === '127.0.0.1', JSON.stringify(s?.overlay))
check('a wrong master password is refused', (await call('vaultUnlock', 'not-it')) === false && (await state()).passwords.locked)
check('the right one unlocks', (await call('vaultUnlock', MASTER)) === true)
const filled2 = await until(async () => ((await p.inputValue('#pw')) === PASS + '-new' ? 'ok' : null))
check('and the login is filled right after', filled2 === 'ok' && !(await state()).overlay)
await app.close()

// After a restart the vault is locked again; with no OS check available, Show asks for the master password.
app = await launch('unavailable')
ui = await pageOf((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
s = await until(async () => ((await state()).passwords ? state() : null))
check('a restart leaves the vault locked', s.passwords.locked === true && s.passwords.master === true)
check('a wrong master password shows nothing', (await call('passwordReveal', csvId, 'nope'))?.password === undefined)
check('Show with the master password works without Windows Hello', (await call('passwordReveal', csvId, MASTER))?.password === 'p,1')
check('removing it needs the current one', !!(await call('vaultRemoveMaster', 'nope')).error && (await call('vaultRemoveMaster', MASTER)).ok === true)
check('without it the vault is open after a restart', !(await state()).passwords.locked)
const disk2 = readFileSync(join(userData, 'passwords.json'), 'utf-8')
check('passwords.json still holds no password in the clear', !disk2.includes(PASS) && !disk2.includes('p,1'))

await app.close()
srv.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
