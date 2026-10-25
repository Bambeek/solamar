// Screenshots of the bar layout from a hidden window: frame, page and (for the flyout shot) the overlay, saved as
// separate PNGs plus a JSON of where each goes; tests/e2e/compose.py stacks them into one picture per state.
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData, out] = process.argv.slice(2)

// Each page gets its own letter icon, so the strip looks like real sites rather than five copies of 127.0.0.1.
const icon = (color, letter) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='${color}'/><text x='16' y='22' font-family='Segoe UI,Arial' font-size='18' font-weight='700' fill='white' text-anchor='middle'>${letter}</text></svg>`)}`
const page = (title, color, body, letter = title[0].toUpperCase()) =>
  `<!doctype html><meta charset=utf-8><link rel=icon href="${icon(color, letter)}"><title>${title}</title><style>body{margin:0;font:15px/1.6 system-ui;color:#1d1b26}header{background:${color};color:#fff;padding:22px 32px;font-size:22px;font-weight:600}main{padding:24px 32px;max-width:760px}.c{height:12px;border-radius:6px;background:#e7e5ee;margin:12px 0}</style><header>${title}</header><main>${body}<div class=c style="width:70%"></div><div class=c style="width:90%"></div><div class=c style="width:55%"></div><div class=c style="width:80%"></div></main>`
const pages = {
  '/mail': page('Inbox', '#3e63dd', '<p>12 unread · Meeting moved to Friday · Your invoice is ready</p>'),
  '/code': page('solamar / pull requests', '#24292f', '<p>feat: bar layout · fix: crash restore · chore: deps</p>'),
  '/video': page('Lo-fi beats to code to', '#c4302b', '<p>Live · 12k watching</p>', 'Y'),
  '/video2': page('How Electron works', '#c4302b', '<p>18:42</p>', 'Y'),
  '/video3': page('Synthwave mix 2026', '#c4302b', '<p>1:02:10</p>', 'Y'),
  '/docs': page('Design notes', '#12a5b0', '<p>Top bar, icon strip, flyout list.</p>'),
  '/news': page('Morning brief', '#f5a524', '<p>Five things to know today.</p>')
}
const srv = createServer((q, r) => (r.writeHead(200, { 'content-type': 'text/html' }), r.end(pages[q.url] ?? page('Page', '#7c6cf2', ''))))
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const win = async (pred) => {
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find(pred)
    if (w) return w
    await sleep(200)
  }
  throw new Error('no window')
}
const ui = await win((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1280, height: 760 }))
await call('updateSettings', { onboarded: true, layout: 'bar' })
// Hidden windows do not run CSS transitions; without this the frame keeps the previous theme's colours.
const still = (w) => w.addStyleTag({ content: '*, :root { transition: none !important; animation: none !important; }' })
await still(ui)
let s = await call('state')
const personal = s.spaces[0]
await call('createSpace', { title: 'Work', icon: 'briefcase', theme: { color: '#3e63dd', mode: 'dark', texture: 'none', intensity: 0.7 } })
await call('createSpace', { title: 'Dev', icon: 'code', theme: { color: '#12a5b0', mode: 'dark', texture: 'none', intensity: 0.7 } })
await call('switchSpace', personal.id)
for (const p of ['/news', '/docs', '/video3', '/video2', '/video', '/code', '/mail']) await call('openTab', base + p)
s = await call('state')
const byPath = (p) => s.items.find((i) => i.url === base + p)
await call('moveItem', byPath('/mail').id, { section: 'favorites', parentId: null, index: 0 })
await call('activate', byPath('/code').id)
await call('run', 'pinTab')
// Docs and news as a group, the way AI tidy-up leaves them.
const group = await call('createFolder', 'today', null)
await call('rename', group, 'Reading')
await call('moveItem', byPath('/news').id, { section: 'today', parentId: group, index: 0 })
await call('activate', byPath('/video2').id)
await sleep(1500)

const shoot = async (name, flyout = false) => {
  const st = await call('state')
  const pg = await win((w) => w.url() === base + '/video2')
  await ui.screenshot({ path: `${out}/${name}-frame.png` })
  await pg.screenshot({ path: `${out}/${name}-page.png` })
  const layers = { frame: `${name}-frame.png`, page: `${name}-page.png`, pageAt: [8, st.settings.sidebarVisible ? 84 : 46], radius: 10 }
  if (flyout) {
    const ov = await win((w) => w.url().endsWith('#overlay'))
    await still(ov)
    await call('openOverlay', 'tabs')
    await sleep(150)
    await ov.mouse.move(120, 200) // over the list, so it stays open
    await sleep(400)
    await ov.screenshot({ path: `${out}/${name}-overlay.png`, omitBackground: true })
    Object.assign(layers, { overlay: `${name}-overlay.png`, overlayAt: [0, 46] }) // BAR in browser.ts
    await call('closeOverlay')
  }
  writeFileSync(`${out}/${name}.json`, JSON.stringify(layers))
}

for (const mode of ['dark', 'light']) {
  await call('updateSpace', personal.id, { theme: { ...personal.theme, mode } })
  await sleep(900)
  await shoot(`bar-${mode}`)
}
await call('updateSpace', personal.id, { theme: { ...personal.theme, mode: 'dark' } })
await call('openBoost')
await sleep(900)
await shoot('bar-boost')
await call('closeBoost')
await app.close()
srv.close()
console.log('ok')
