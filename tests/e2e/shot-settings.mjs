// Screenshots of every Settings section in dark and light, plus a search with no match.
// Usage: node tests/e2e/shot-settings.mjs <userData dir> <out dir> [app entry, default '.']
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
const [userData, out, entry = '.'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const app = await electron.launch({ args: [entry, '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith('#' + h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('ui'), overlay = await page('overlay')
await ui.waitForLoadState('domcontentloaded')
const errors = []
overlay.on('pageerror', (e) => errors.push(e.message))
overlay.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await call('openOverlay', 'settings')
await overlay.waitForSelector('.settings')
await overlay.evaluate(() => document.fonts.ready)
const sections = await overlay.locator('.set-tabs button').allTextContents()
for (const scheme of ['dark', 'light']) {
  await overlay.emulateMedia({ colorScheme: scheme })
  await wait(400)
  for (const name of sections) {
    await overlay.locator('.set-tabs button', { hasText: name }).first().click()
    await wait(350)
    await overlay.locator('.settings').screenshot({ path: join(out, `${scheme}-${name.toLowerCase().replace(/\W+/g, '-')}.png`) })
  }
  await overlay.fill('.set-search input', 'proxy')
  await wait(300)
  await overlay.locator('.settings').screenshot({ path: join(out, `${scheme}-search-empty.png`) })
  await overlay.fill('.set-search input', 'sleep')
  await wait(300)
  await overlay.locator('.settings').screenshot({ path: join(out, `${scheme}-search.png`) })
  await overlay.fill('.set-search input', '')
}
// Picking an app icon goes through the main process and comes back as the selected tile.
await overlay.locator('.set-tabs button', { hasText: 'Appearance' }).first().click()
await overlay.locator('.icon-grid button', { hasText: 'Ink' }).click()
await overlay.waitForSelector('.icon-grid button.on:has-text("Ink")', { timeout: 5000 })
console.log('icon picked: ink')
await overlay.locator('.icon-grid button', { hasText: 'Classic' }).click()
await overlay.waitForSelector('.icon-grid button.on:has-text("Classic")', { timeout: 5000 })
console.log('sections', sections.length, errors.length ? 'ERRORS ' + errors.join(' | ') : 'no errors')
await app.close()
