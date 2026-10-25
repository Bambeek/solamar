// "Save page for Claude" on a local page: the folder and every file in it, what content.md and design.json hold,
// the full-page screenshot, index.json and the root README, and the notice.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const clips = join(userData, 'clips')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAQklEQVR4nO3PQQ0AIBDAsIF/z+CCD2kV7DlbAQAAAAAAAAAA8NUBzQkBAQ0LSHY2AAAAAElFTkSuQmCC', 'base64')
const html = `<!doctype html><meta charset=utf-8><title>Acme design system</title>
<style>body{margin:0;font:16px/1.6 Georgia,serif;color:#222;background:#fdfbf7}header{background:#1f3a5f;color:#fff;padding:24px}main{max-width:720px;margin:auto;padding:24px}
.btn{background:#e4572e;color:#fff;border-radius:999px;padding:10px 22px;border:0;font-weight:700}.card{border:1px solid #ddd;border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.1);margin:16px 0}.tall{height:2400px}</style>
<header><h1>Acme design system</h1></header>
<main><h2>Buttons</h2><p>Primary actions use the coral button.</p><button class=btn>Get started</button>
<div class=card><h3>Card</h3><p>Cards have soft shadows and 14px corners.</p><img src="/logo.png" alt="Acme logo" width=64 height=64></div>
<ul><li>Navy header</li><li>Serif body text</li></ul><p><a href="https://example.com/docs">Read the docs</a></p><div class=tall></div><p>The end of the page.</p></main>`
const site = createServer((q, r) => {
  if (q.url === '/logo.png') return r.writeHead(200, { 'content-type': 'image/png' }), r.end(png)
  r.writeHead(200, { 'content-type': 'text/html' })
  r.end(html)
})
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${site.address().port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
let ui
for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true, clipsDir: clips })
await call('openTab', base + '/')
for (let i = 0; i < 50 && !app.windows().find((w) => w.url() === base + '/'); i++) await sleep(200)
await sleep(1200)

await call('runAction', 'save-for-claude')
let s
for (let i = 0; i < 100; i++) {
  s = await call('state')
  if (s.notice?.path || s.notice?.error) break
  await sleep(150)
}
check('a notice with the folder shows', !!s.notice?.path && !s.notice.error, JSON.stringify(s.notice))
// The notice is drawn by the overlay, the only view above the page, at the bottom of the window.
const views = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].contentView.children.map((c) => ({ url: c.webContents.getURL(), b: c.getBounds() })))
const topView = views[views.length - 1]
check('the notice sits above the page, at the bottom', s.overlay?.kind === 'notice' && topView.url.endsWith('#overlay') && topView.b.y > 600 && topView.b.height < 120, JSON.stringify(topView))
const ov = app.windows().find((w) => w.url().endsWith('#overlay'))
check('it says where the page went and offers Open folder', /Saved for Claude/.test(await ov.locator('.notice-toast').innerText()) && (await ov.locator('.notice-toast button', { hasText: 'Open folder' }).count()) === 1)
await call('dismissNotice')
check('dismissing it frees the overlay', !(await call('state')).overlay)
const dir = s.notice?.path ?? ''
check('the folder sits in the clips folder and is named date-site-title', dir.startsWith(clips) && /\d{4}-\d\d-\d\d-127-0-0-1-acme-design-system$/.test(dir), dir)
const files = existsSync(dir) ? readdirSync(dir) : []
for (const f of ['page.html', 'page_files', 'screenshot.png', 'screenshot-top.png', 'content.md', 'design.json', 'meta.json', 'README.md']) check(`has ${f}`, files.includes(f))
check('page_files holds the image', existsSync(join(dir, 'page_files')) && readdirSync(join(dir, 'page_files')).some((f) => /logo/.test(f)))
const size = (f) => {
  const b = readFileSync(join(dir, f))
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
const full = existsSync(join(dir, 'screenshot.png')) ? size('screenshot.png') : { h: 0 }
const top = existsSync(join(dir, 'screenshot-top.png')) ? size('screenshot-top.png') : { h: 0 }
check('screenshot.png is the whole page, taller than the window', full.h > 2400 && full.h > top.h, JSON.stringify({ full, top }))
const md = existsSync(join(dir, 'content.md')) ? readFileSync(join(dir, 'content.md'), 'utf-8') : ''
check('content.md has the headings, text, list and links', md.includes('# Acme design system') && md.includes('## Buttons') && md.includes('Primary actions use the coral button.') && md.includes('- Navy header') && md.includes('(https://example.com/docs)'))
check('content.md lists the image', /logo\.png \(64x64\) "Acme logo"/.test(md))
const design = existsSync(join(dir, 'design.json')) ? JSON.parse(readFileSync(join(dir, 'design.json'), 'utf-8')) : {}
check('design.json has the page colours and fonts', design.page?.background === 'rgb(253, 251, 247)' && /Georgia/.test(design.page?.fontFamily ?? ''))
check('design.json has the button style', design.buttons?.some((b) => b.background === 'rgb(228, 87, 46)' && b.borderRadius === '999px'), JSON.stringify(design.buttons?.[0]))
check('design.json has radii and shadows', design.radii?.some((r) => r.value === '14px') && design.shadows?.length > 0)
check('design.json has type sizes', design.typography?.h1?.fontSize && design.typography?.p?.fontFamily)
const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')) : {}
check('meta.json has the address and title', meta.url === base + '/' && meta.title === 'Acme design system')
const index = JSON.parse(readFileSync(join(clips, 'index.json'), 'utf-8'))
check('index.json lists the clip first', index[0]?.dir === dir)
check('the clips folder has a README for Claude', /Pages saved from Solamar/.test(readFileSync(join(clips, 'README.md'), 'utf-8')))
check('state names the clips folder', s.clipsRoot === clips)

await call('runAction', 'save-for-claude')
for (let i = 0; i < 100; i++) {
  s = await call('state')
  if (s.notice?.path && s.notice.path !== dir) break
  await sleep(150)
}
check('saving again makes a second folder, not an overwrite', !!s.notice?.path && s.notice.path === dir + '-2', s.notice?.path)
await call('openOverlay', 'settings')
await sleep(300)
check('with a dialog open, the notice shows inside it', (await ov.locator('.notice-host.in-dialog .notice-toast').count()) === 1)
await call('closeOverlay')
await sleep(300)
check('closing the dialog brings the notice strip back', (await call('state')).overlay?.kind === 'notice')

await app.close()
site.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
