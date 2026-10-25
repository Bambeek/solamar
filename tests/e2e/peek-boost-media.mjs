// Peek (pinned-tab links, Shift+click, open as tab), Boosts (live CSS, filter, zap, JS) and the mini player.
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)

// Two seconds of a quiet 440 Hz tone, so the tab is really audible.
function toneWav() {
  const rate = 8000
  const n = rate * 2
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0), b.writeUInt32LE(36 + n * 2, 4), b.write('WAVEfmt ', 8), b.writeUInt32LE(16, 16), b.writeUInt16LE(1, 20), b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24), b.writeUInt32LE(rate * 2, 28), b.writeUInt16LE(2, 32), b.writeUInt16LE(16, 34), b.write('data', 36), b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2)
  return b
}
const wav = toneWav()
let port = 0
const srv = createServer((q, r) => {
  if (q.url === '/tone.wav') return r.writeHead(200, { 'content-type': 'audio/wav' }), r.end(wav)
  r.writeHead(200, { 'content-type': 'text/html' })
  if (q.url === '/b') return r.end('<title>Two</title><p id=p>page two</p>')
  if (q.url === '/media') return r.end('<title>Tune</title><audio id=a src="/tone.wav" loop></audio>')
  r.end(
    `<title>One</title><a id=ext href="http://localhost:${port}/b">elsewhere</a> <a id=same href="/b">same site</a>` +
      '<div id=zapme style="height:60px;background:#fc0">banner</div><p id=keep>content</p>'
  )
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
port = srv.address().port
const base = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))
const until = async (fn, ms = 6000) => {
  for (let t = 0; t < ms; t += 100) {
    const v = await fn().catch(() => null)
    if (v) return v
    await sleep(100)
  }
  return null
}

const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const pageOf = (pred) => until(async () => app.windows().find(pred))
const ui = await pageOf((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const state = () => call('state')
await call('updateSettings', { onboarded: true })

// ---------- Peek ----------
await call('openTab', base + '/a')
const one = await pageOf((w) => w.url() === base + '/a')
await one.waitForLoadState('load')
await call('run', 'pinTab')
const pinnedId = (await state()).activeId
check('tab is pinned', (await state()).items.find((i) => i.id === pinnedId)?.section === 'pinned')
await one.click('#ext')
let s = await until(async () => ((await state()).peek ? state() : null))
check('a link to another site from a pinned tab opens in Peek', s?.peek?.url?.includes('localhost') && s.overlay?.kind === 'peek', JSON.stringify(s?.peek && { url: s.peek.url }))
check('the pinned tab stays where it was', one.url() === base + '/a')
s = await until(async () => ((await state()).peek?.title === 'Two' ? state() : null))
check('peek shows the page title', s?.peek?.title === 'Two')
const peekPage = await pageOf((w) => w.url().startsWith(`http://localhost:${port}/b`))
await peekPage.evaluate(() => (window.__mark = 42))
const before = (await state()).items.length
await call('promotePeek', false)
s = await state()
const promoted = s.items.find((i) => i.id === s.activeId)
check('Open as tab makes a new active tab', s.items.length === before + 1 && promoted?.url?.includes('localhost') && !s.peek && !s.overlay, JSON.stringify({ n: s.items.length, url: promoted?.url }))
check('the page is kept, not reloaded', (await peekPage.evaluate(() => window.__mark).catch(() => null)) === 42)

await call('activate', pinnedId)
await one.click('#same')
await sleep(600)
check('a same-site link in a pinned tab navigates normally', one.url() === base + '/b' && !(await state()).peek, one.url())
await one.goBack()
await one.waitForLoadState('load')
await one.click('#ext', { modifiers: ['Shift'] })
s = await until(async () => ((await state()).peek ? state() : null))
check('Shift+click opens Peek', !!s?.peek)
const peek2 = await pageOf((w) => w.url().startsWith(`http://localhost:${port}/b`) && w !== peekPage)
await peek2.waitForLoadState('load')
// Real key input (CDP keys skip before-input-event, where Solamar's shortcuts live).
await app.evaluate(({ webContents }, u) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(u))
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
}, `http://localhost:${port}/b`)
s = await until(async () => (!(await state()).peek ? state() : null))
check('Escape closes Peek', !!s && !s.peek && !s.overlay)

// ---------- Boosts ----------
await call('openBoost')
s = await until(async () => ((await state()).boostEditor ? state() : null))
const boost = s?.boosts.find((b) => b.id === s.boostEditor.id)
check('Boost this site opens the editor for the site', boost?.domain === '127.0.0.1', JSON.stringify(boost))
await call('updateBoost', boost.id, { css: '#keep { color: rgb(1, 2, 3) !important; }' })
const color = await until(async () => {
  const c = await one.evaluate(() => getComputedStyle(document.getElementById('keep')).color)
  return c === 'rgb(1, 2, 3)' ? c : null
})
check('CSS applies live', color === 'rgb(1, 2, 3)')
await call('updateBoost', boost.id, { filter: 'gray', hue: 90 })
const filter = await until(async () => {
  const f = await one.evaluate(() => getComputedStyle(document.documentElement).filter)
  return f.includes('grayscale') ? f : null
})
check('colour filter applies', !!filter && filter.includes('hue-rotate(90deg)'), filter)
await call('updateBoost', boost.id, { css: '' })
const reset = await until(async () => ((await one.evaluate(() => getComputedStyle(document.getElementById('keep')).color)) !== 'rgb(1, 2, 3)' ? 'ok' : null))
check('removed CSS goes away live', reset === 'ok')

await ui.evaluate(() => void window.solamar.call('startZap'))
await until(async () => (await state()).boostEditor?.zapping)
const box = await one.locator('#zapme').boundingBox()
await one.mouse.move(box.x + 20, box.y + 20)
await sleep(100)
await one.mouse.click(box.x + 20, box.y + 20)
s = await until(async () => {
  const st = await state()
  return st.boosts.find((b) => b.id === boost.id)?.zaps.length ? st : null
})
const zaps = s?.boosts.find((b) => b.id === boost.id)?.zaps ?? []
check('zap records a selector for the clicked element', zaps.length === 1, JSON.stringify(zaps))
const hidden = await until(async () => ((await one.evaluate(() => getComputedStyle(document.getElementById('zapme')).display)) === 'none' ? 'ok' : null))
check('zapped element is hidden', hidden === 'ok')
check('other content stays', (await one.evaluate(() => getComputedStyle(document.getElementById('keep')).display)) !== 'none')
await one.keyboard.press('Escape')
s = await until(async () => ((await state()).boostEditor?.zapping === false ? state() : null))
check('Escape ends zap mode', !!s)

await call('updateBoost', boost.id, { js: "document.body.dataset.boosted = 'yes'" })
await one.reload()
await one.waitForLoadState('load')
const ran = await until(async () => ((await one.evaluate(() => document.body.dataset.boosted)) === 'yes' ? 'ok' : null))
check('boost JS runs when the page loads', ran === 'ok')
check('zap survives a reload', (await one.evaluate(() => getComputedStyle(document.getElementById('zapme')).display)) === 'none')
await call('closeBoost')
s = await until(async () => (!(await state()).boostEditor ? state() : null))
check('closing keeps a boost that has changes', !!s && s.boosts.some((b) => b.id === boost.id))
await call('updateBoost', boost.id, { enabled: false })
const off = await until(async () => ((await one.evaluate(() => getComputedStyle(document.getElementById('zapme')).display)) !== 'none' ? 'ok' : null))
check('turning a boost off shows zapped things again', off === 'ok')

// ---------- mini player ----------
await call('openTab', base + '/media')
const media = await pageOf((w) => w.url() === base + '/media')
await media.waitForLoadState('load')
const mediaId = (await state()).activeId
// Muted tab: Chromium still reports it audible, but nothing reaches the speakers or headphones.
await app.evaluate(({ webContents }, u) => webContents.getAllWebContents().find((w) => w.getURL() === u)?.setAudioMuted(true), base + '/media')
await media.evaluate(() => document.getElementById('a').play())
const audible = await until(async () => (await state()).runtime[mediaId]?.audible, 8000)
if (!audible) console.log('SKIP mini player - the tab never became audible (no audio device?)')
else {
  await call('activate', pinnedId)
  s = await until(async () => ((await state()).media ? state() : null))
  check('mini player shows for media playing in another tab', s?.media?.id === mediaId && s.media.playing === true, JSON.stringify(s?.media))
  check('mini player has the page title', s?.media?.title === 'Tune', s?.media?.title)
  await call('mediaAction', 'toggle')
  s = await until(async () => ((await state()).media?.playing === false ? state() : null))
  check('pause from the mini player', !!s && (await media.evaluate(() => document.getElementById('a').paused)))
  await call('mediaAction', 'toggle')
  s = await until(async () => ((await state()).media?.playing ? state() : null))
  check('play again from the mini player', !!s)
  await call('mediaAction', 'close')
  s = await until(async () => (!(await state()).media ? state() : null))
  check('stop closes the player and pauses', !!s && (await media.evaluate(() => document.getElementById('a').paused)))
}

await app.close()
srv.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
