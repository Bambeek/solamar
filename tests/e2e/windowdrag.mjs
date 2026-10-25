// Dragging the window by the sidebar's top row and by the strip above the page, with real mouse events.
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith('#' + h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('ui')
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true })
await ui.waitForSelector('.sidebar-top')
const pos = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getPosition())
const mouse = (events) => app.evaluate(({ webContents }, events) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL().endsWith('#ui'))
  for (const e of events) wc.sendInputEvent(e)
}, events)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Like a real drag: the cursor moves on screen, so the point under it inside the (moving) window stays put.
async function drag(x, y, dx, dy) {
  const [wx, wy] = await pos()
  await mouse([{ type: 'mouseDown', x, y, globalX: wx + x, globalY: wy + y, button: 'left', clickCount: 1 }])
  await sleep(100)
  for (let i = 1; i <= 5; i++) {
    const gx = wx + x + Math.round((dx * i) / 5), gy = wy + y + Math.round((dy * i) / 5)
    const [cx, cy] = await pos()
    await mouse([{ type: 'mouseMove', x: gx - cx, y: gy - cy, globalX: gx, globalY: gy, button: 'left', modifiers: ['leftButtonDown'] }])
    await sleep(60)
  }
  const [cx, cy] = await pos()
  await mouse([{ type: 'mouseUp', x: wx + x + dx - cx, y: wy + y + dy - cy, globalX: wx + x + dx, globalY: wy + y + dy, button: 'left', clickCount: 1 }])
  await sleep(250)
}
const grow = await ui.locator('.sidebar-top .grow').boundingBox()
const p0 = await pos()
await drag(Math.round(grow.x + grow.width / 2), Math.round(grow.y + grow.height / 2), 120, 60)
const p1 = await pos()
console.log(`sidebar top: ${p0} -> ${p1} (expected +120,+60)`, p1[0] - p0[0] === 120 && p1[1] - p0[1] === 60 ? 'PASS' : 'FAIL')
const strip = await ui.locator('.drag-strip').boundingBox()
await drag(Math.round(strip.x + 200), Math.round(strip.y + 4), -50, 30)
const p2 = await pos()
console.log(`strip above page: ${p1} -> ${p2} (expected -50,+30)`, p2[0] - p1[0] === -50 && p2[1] - p1[1] === 30 ? 'PASS' : 'FAIL')
const btn = await ui.locator('.sidebar-top .icon-btn').first().boundingBox()
await drag(Math.round(btn.x + btn.width / 2), Math.round(btn.y + btn.height / 2), 80, 0)
const p3 = await pos()
console.log(`buttons do not drag: ${p2} -> ${p3}`, p3[0] === p2[0] ? 'PASS' : 'FAIL')
await app.close()
