import { _electron as electron } from 'playwright'
const [userData, out] = process.argv.slice(2)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith('#' + h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('ui'), overlay = await page('overlay')
await ui.waitForLoadState('domcontentloaded')
overlay.on('pageerror', (e) => console.log('PAGEERROR', e.message))
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('openOverlay', 'space-new', { mode: 'new' })
await overlay.waitForSelector('.theme-editor')
await new Promise((r) => setTimeout(r, 1200))
console.log('icon choices', await overlay.locator('.icon-choice').count(), 'guard', await overlay.locator('.guard').count())
await overlay.screenshot({ path: out })
await app.close()
