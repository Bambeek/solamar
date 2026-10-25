// Sidebar edge drag: real mouse events into the frame view, then into the resize overlay.
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith('#' + h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('ui')
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true, layout: 'sidebar' }) // this test is about the classic sidebar
await ui.waitForSelector('.sidebar-resizer')
const box = await ui.locator('.sidebar-resizer').boundingBox()
const y = Math.round(box.y + box.height / 2)
const send = (url, events) => app.evaluate(({ webContents }, [url, events]) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL().endsWith(url))
  for (const e of events) wc.sendInputEvent(e)
}, [url, events])
const x0 = Math.round(box.x + box.width / 2)
await send('#ui', [{ type: 'mouseDown', x: x0, y, button: 'left', clickCount: 1 }, { type: 'mouseMove', x: x0 + 40, y, button: 'left' }])
await new Promise((r) => setTimeout(r, 300))
const mid = (await call('state')).settings.sidebarWidth
// The overlay is up now; continue the drag there, as the OS would once the pointer is over a web page.
await send('#overlay', [{ type: 'mouseMove', x: 360, y, button: 'left', modifiers: ['leftButtonDown'] }])
await new Promise((r) => setTimeout(r, 300))
await send('#overlay', [{ type: 'mouseUp', x: 360, y, button: 'left', clickCount: 1 }])
await send('#ui', [{ type: 'mouseUp', x: 360, y, button: 'left', clickCount: 1 }])
await new Promise((r) => setTimeout(r, 300))
const s = await call('state')
console.log(`start 264 -> after frame move ${mid} -> after overlay move ${s.settings.sidebarWidth}; overlay closed: ${s.overlay === null}`)
await call('setSidebarWidth', 9999)
console.log('clamped to', (await call('state')).settings.sidebarWidth)
await app.close()
