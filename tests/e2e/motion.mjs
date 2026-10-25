// Sidebar slide: the page is swapped for a still picture during the slide and resized once at the end
// (no per-frame resizing, which stuttered on heavy pages).
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith(h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('#ui')
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true, layout: 'sidebar' }) // this test is about the classic sidebar
await call('openTab', 'data:text/html,<body style="background:linear-gradient(90deg,red,blue)">motion</body>#motion')
await new Promise((r) => setTimeout(r, 1000))
const sample = () => app.evaluate(async ({ BaseWindow }) => {
  const out = []
  const t0 = Date.now()
  while (Date.now() - t0 < 520) {
    const v = BaseWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents?.getURL().includes('motion'))
    out.push(v ? v.getBounds().x : 'pic')
    await new Promise((r) => setTimeout(r, 25))
  }
  return out
})
for (const label of ['hide', 'show']) {
  const p = sample()
  await call('run', 'toggleSidebar')
  const seq = await p
  const xs = seq.filter((x) => x !== 'pic')
  const distinct = [...new Set(xs)]
  const ok = seq.includes('pic') && distinct.length === 2
  console.log(`${label}: ${seq.join(' ')}  ->  ${ok ? 'PASS picture during slide, one resize' : 'FAIL'}`)
  await new Promise((r) => setTimeout(r, 300))
}
const s = await call('state')
console.log('snapshot cleared:', s.layoutSnapshot === null ? 'PASS' : 'FAIL')
await app.close()
