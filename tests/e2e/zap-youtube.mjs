// Zap on a real, heavy site (YouTube): pick an element in the masthead, then check it is hidden and stays hidden.
// Muted; nothing is signed in or typed.
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const win = async (pred) => { for (let i = 0; i < 150; i++) { const w = app.windows().find(pred); if (w) return w; await sleep(200) } return null }
const ui = await win((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const state = () => call('state')
await call('updateSettings', { onboarded: true })
// Google's "reject all" consent cookie on the throwaway profile, so no consent dialog covers the page.
await app.evaluate(async ({ session }) => {
  await session.fromPartition('persist:solamar-default').cookies.set({ url: 'https://www.youtube.com', domain: '.youtube.com', name: 'SOCS', value: 'CAI', secure: true })
})
await call('openTab', 'https://www.youtube.com/')
const yt = await win((w) => w.url().startsWith('https://www.youtube.com'))
await yt.waitForLoadState('load').catch(() => {})
await sleep(4000)
await call('openBoost')
await sleep(800)
const target = (await yt.$('ytd-masthead #buttons ytd-button-renderer')) ? 'ytd-masthead #buttons ytd-button-renderer' : 'ytd-masthead #logo'
const box = await yt.locator(target).first().boundingBox()
console.log('target', target, JSON.stringify(box))
await ui.evaluate(() => void window.solamar.call('startZap'))
for (let i = 0; i < 30 && !(await state()).boostEditor?.zapping; i++) await sleep(100)
await yt.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await sleep(150)
await yt.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
let s
for (let i = 0; i < 40; i++) {
  s = await state()
  if (s.boosts[0]?.zaps.length) break
  await sleep(100)
}
const sel = s.boosts[0]?.zaps[0]
console.log('selector', sel)
await sleep(800)
const diag = await yt.evaluate((sel) => {
  let matches = -1
  try {
    matches = document.querySelectorAll(sel).length
  } catch (e) {
    matches = 'invalid: ' + e.message
  }
  const el = (() => {
    try {
      return document.querySelector(sel)
    } catch {
      return null
    }
  })()
  return { matches, display: el ? getComputedStyle(el).display : null, inShadow: el ? el.getRootNode() !== document : null }
}, sel)
console.log('diag', JSON.stringify(diag))
const css = await yt.evaluate(() => [...document.styleSheets].length)
const boost = (await state()).boosts[0]
console.log('boost', JSON.stringify({ domain: boost.domain, enabled: boost.enabled, zaps: boost.zaps }), 'sheets', css)
const button = await yt.evaluate((t) => {
  const el = document.querySelector(t)
  const r = el ? el.getBoundingClientRect() : null
  return { width: r ? Math.round(r.width) : null, display: el ? getComputedStyle(el).display : null }
}, target)
console.log('button', JSON.stringify(button))
console.log(diag.display === 'none' && diag.matches === 1 ? 'PASS the selector matches one element and it is hidden' : 'FAIL zapped element still shows')
console.log(button.display === 'none' || button.width === 0 ? 'PASS the button a person sees is gone' : 'FAIL the visible button is still there')
await call('stopZap')
await app.close()
