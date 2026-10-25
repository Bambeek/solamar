// Screenshots of the password protection UI from a hidden window: Settings > Passwords with the master password off,
// on and locked, and the unlock card a page fill opens. Test logins only; SOLAMAR_TEST_OS_AUTH stands in for Windows
// Hello. Usage: node tests/e2e/shot-vault.mjs <userData dir> <out dir>
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const [userData, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const srv = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' })
  r.end('<title>Login</title><form><input id=email type=email autocomplete=username><input id=pw type=password><button>Sign in</button></form>')
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, SOLAMAR_TEST_OS_AUTH: 'verified' } })
const page = async (pred) => {
  for (;;) {
    const p = app.windows().find(pred)
    if (p) return p
    await new Promise((r) => setTimeout(r, 200))
  }
}
const ui = await page((w) => w.url().endsWith('#ui'))
const overlay = await page((w) => w.url().endsWith('#overlay'))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await app.evaluate(({ nativeTheme, BaseWindow }) => {
  nativeTheme.themeSource = 'dark'
  BaseWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1280, height: 800 })
})
await call('updateSettings', { onboarded: true })
await call('passwordsImportCsv', `name,url,username,password\r\nA,${base}/,ada@example.test,test-pass-1\r\nB,https://github.com/,ada,test-pass-2\r\nC,https://mail.example.test/,ada@example.test,test-pass-3\r\n`)

const settings = async (name) => {
  await call('openOverlay', 'settings')
  await overlay.waitForSelector('.settings')
  await overlay.locator('.set-tabs button', { hasText: 'Passwords' }).first().click()
  await wait(500)
  await overlay.locator('.settings').screenshot({ path: join(out, name + '.png') })
}
await settings('1-master-off')
await overlay.getByRole('button', { name: 'Set a master password' }).click()
await wait(300)
await overlay.locator('.settings').screenshot({ path: join(out, '2-set-form.png') })
await call('closeOverlay')
await call('vaultSetMaster', 'correct horse battery')
await settings('3-master-on')
await call('closeOverlay')
await call('vaultLock')
await settings('4-locked')
await call('closeOverlay')

await call('openTab', base + '/')
const p = await page((w) => w.url() === base + '/')
await p.waitForLoadState('load')
await p.click('#email')
for (let i = 0; i < 30 && !(await p.$('solamar-logins')); i++) await wait(150)
const box = await p.locator('solamar-logins').boundingBox()
await p.mouse.click(box.x + 30, box.y + 20)
for (let i = 0; i < 30 && (await call('state')).overlay?.kind !== 'vault-unlock'; i++) await wait(150)
await wait(500)
await overlay.screenshot({ path: join(out, '5-unlock-card.png') })
await app.close()
srv.close()
console.log('done')
