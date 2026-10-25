// Sidebar screenshots with real favorites (Arc import into a throwaway profile), dark and light, two widths.
import { _electron as electron } from 'playwright'
const [userData, out] = process.argv.slice(2)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith('#' + h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('ui')
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await call('updateSettings', { onboarded: true })
const scan = await call('arcScan')
if (scan.found) await call('arcImport', { includeToday: false })
let s = await call('state')
const personal = s.spaces[0]
await call('switchSpace', personal.id)
const fav = s.items.find((i) => i.section === 'favorites' && /github/i.test(i.url ?? '')) ?? s.items.find((i) => i.section === 'favorites')
if (fav) await call('activate', fav.id)
await call('openTab', 'https://example.com/')
await sleep(2500)
for (const [mode, w] of [['dark', 200], ['dark', 264], ['light', 264]]) {
  await call('updateSpace', personal.id, { theme: { ...personal.theme, mode } })
  await call('setSidebarWidth', w)
  await sleep(1200)
  await ui.screenshot({ path: `${out}/sidebar-c-${mode}-${w}.png`, clip: { x: 0, y: 0, width: w + 8, height: 560 } })
}
await app.close()
console.log('ok', scan.found ? 'with Arc favorites' : 'no Arc data')
