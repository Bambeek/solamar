// What Solamar tells websites about itself (User-Agent string and client hints), and what the ad blocker blocks on a login page.
import { _electron as electron } from 'playwright'
const [userData, url = 'https://www.facebook.com/login/'] = process.argv.slice(2)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const page = async (pred) => { for (;;) { const p = app.windows().find(pred); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
await ui.evaluate(() => window.solamar.call('updateSettings', { onboarded: true }))
for (let i = 0; i < 30 && !(await ui.evaluate(() => window.solamar.call('state'))).adblockReady; i++) await new Promise((r) => setTimeout(r, 500))
await ui.evaluate((u) => window.solamar.call('openTab', u), url)
const tab = await page((w) => /facebook\.com/.test(w.url()))
await tab.waitForLoadState('load').catch(() => {})
await new Promise((r) => setTimeout(r, 3000))
const info = await tab.evaluate(async () => ({
  ua: navigator.userAgent,
  brands: navigator.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`),
  title: document.title,
  hasPasswordField: !!document.querySelector('input[type=password]'),
  bodyStart: document.body.innerText.slice(0, 200).replace(/\s+/g, ' ')
}))
const s = await ui.evaluate(() => window.solamar.call('state'))
const id = s.items.find((i) => /facebook/.test(i.url ?? ''))?.id
console.log(JSON.stringify({ ...info, blocked: s.runtime[id]?.blocked }, null, 1))
await app.close()
