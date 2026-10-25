// Lists the browsers on this PC and imports one profile's history into a throwaway Solamar profile.
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
let ui
for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await new Promise((r) => setTimeout(r, 200)))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const sources = await call('browserSources')
console.log('sources:', sources.map((s) => `${s.browserName}/${s.profileName} ${JSON.stringify(s.has)}`).join(', ') || 'none')
console.log(sources.every((s) => !('profilePath' in s)) ? 'PASS no file paths reach the UI' : 'FAIL paths leaked')
const withHistory = sources.find((s) => s.has.history)
if (withHistory) {
  const r = await call('browserImport', withHistory.i, { bookmarks: false, history: true })
  const hist = await call('listHistory', '')
  console.log(r.history > 0 && hist.length > 0 ? `PASS imported ${r.history} history pages` : 'FAIL ' + JSON.stringify(r))
  await call('openOverlay', 'import-browser')
  await new Promise((r) => setTimeout(r, 800))
  const ov = app.windows().find((w) => w.url().endsWith('#overlay'))
  const text = await ov.evaluate(() => document.body.innerText)
  console.log(text.includes(withHistory.browserName) && text.includes('Import') ? 'PASS dialog lists the browsers' : 'FAIL dialog: ' + text.slice(0, 200))
} else console.log('SKIP no profile with history on this PC')
await app.close()
