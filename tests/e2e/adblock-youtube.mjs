// Ad block scriptlets (uBlock Origin +js rules) on real YouTube and Google pages: they must run in the page's main
// world before its own scripts, in subframes too, without "Script failed to execute" rejections, and the pages must
// keep working. Needs the network. Hidden window, throwaway profile, all audio muted (YouTube autoplays):
//   npx electron-vite build && node tests/e2e/adblock-youtube.mjs <tempUserDataDir> [youtubeVideoId]
// EU consent walls: the temp profile gets Google's "reject all" consent cookie (SOCS=CAI), never the real profile.
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'

const [userData, videoId = 'dQw4w9WgXcQ'] = process.argv.slice(2)
if (!userData) throw new Error('usage: node tests/e2e/adblock-youtube.mjs <tempUserDataDir> [youtubeVideoId]')
const WATCH = `https://www.youtube.com/watch?v=${videoId}`
const SEARCH = 'https://www.google.com/search?q=laptop&hl=en'

// A local page with elements that generic EasyList rules hide (one added after load, for the DOM-watching path) and
// the YouTube player in an iframe (subframes must get scriptlets too). Served under a .test name mapped to loopback,
// because the lists turn generic hiding off for localhost and 127.0.0.1.
const TEST_HOST = 'solamar-adblock.test'
const srv = createServer((_q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' })
  r.end(`<!doctype html><title>adblock test page</title>
<p id="content">article text</p><ad-slot id="base">base rule</ad-slot><div id="AdSense1">id rule</div><div class="sponsored-ad">class rule</div>
<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}"></iframe>
<script>setTimeout(() => { const d = document.createElement('div'); d.id = 'late'; d.className = 'ad-slot'; d.textContent = 'late ad'; document.body.append(d) }, 1500)</script>`)
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const EMBED_PAGE = `http://${TEST_HOST}:${srv.address().port}/`

const app = await electron.launch({ args: ['.', '--mute-audio', `--host-resolver-rules=MAP ${TEST_HOST} 127.0.0.1`], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const stderr = []
app.process().stderr.on('data', (d) => stderr.push(String(d)))
// Belt and braces on top of --mute-audio: every webContents is muted as it is created, and again after each load.
const muteAll = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().forEach((wc) => wc.setAudioMuted(true)))
await app.evaluate(({ app: electronApp, webContents }) => {
  electronApp.on('web-contents-created', (_e, wc) => wc.setAudioMuted(true))
  webContents.getAllWebContents().forEach((wc) => wc.setAudioMuted(true))
})
// Never leave a hidden Solamar running: close it on any failure, and after 8 minutes at most.
const bail = async (why) => {
  console.log('FAIL', why)
  await app.close().catch(() => {})
  srv.close()
  process.exit(1)
}
const guard = setTimeout(() => void bail('timed out'), 8 * 60 * 1000)
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (err) => void bail(err?.stack ?? err))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const page = async (pred, ms = 30000) => {
  for (let t = 0; t < ms; t += 200) {
    const p = app.windows().find(pred)
    if (p) return p
    await sleep(200)
  }
  throw new Error('no page matching ' + pred)
}
const results = []
const check = (name, ok, detail = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`))
const info = (...a) => console.log('     ', ...a)

// Main process probes: unhandled rejections, and what the page preload got back per frame. event.returnValue cannot
// be read back after it is set, so Solamar's listener is wrapped and handed an event that records the assignment.
await app.evaluate(({ ipcMain }) => {
  globalThis.__rejections = []
  process.on('unhandledRejection', (e) => globalThis.__rejections.push(String(e?.message ?? e)))
  globalThis.__frames = []
  const ch = 'solamar:adblock-cosmetics'
  for (const solamar of ipcMain.listeners(ch)) {
    ipcMain.removeListener(ch, solamar)
    ipcMain.on(ch, (e, f) => {
      const entry = { url: String(f?.url ?? ''), scripts: 'no reply', css: 0 }
      globalThis.__frames.push(entry)
      const seen = new Proxy(e, {
        get: (t, k) => t[k],
        set: (t, k, v) => {
          if (k === 'returnValue') Object.assign(entry, { scripts: v?.scripts?.length ?? null, css: v?.styles?.length ?? 0 })
          t[k] = v
          return true
        }
      })
      solamar(seen, f)
    })
  }
})
const frames = () => app.evaluate(() => globalThis.__frames)
const rejections = () => app.evaluate(() => globalThis.__rejections)

const ui = await page((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true })
for (let i = 0; i < 240 && !(await call('state')).adblockReady; i++) await sleep(500)
check('filter lists loaded', (await call('state')).adblockReady)

const blockedFor = async (re) => {
  const s = await call('state')
  const it = s.items.find((i) => re.test(i.url ?? ''))
  return it ? (s.runtime[it.id]?.blocked ?? 0) : -1
}
const settle = async (tab, ms) => {
  await tab.waitForLoadState('load', { timeout: 30000 }).catch(() => {})
  await muteAll()
  await sleep(ms)
}

// Google's "reject all" consent cookie, in every tab session of this throwaway profile.
const rejectConsent = () =>
  app.evaluate(async ({ webContents }) => {
    const sessions = new Set(webContents.getAllWebContents().filter((w) => /^https?:/.test(w.getURL())).map((w) => w.session))
    const expirationDate = Math.floor(Date.now() / 1000) + 3600 * 24 * 30
    for (const s of sessions)
      for (const domain of ['.youtube.com', '.google.com'])
        await s.cookies.set({ url: `https://www${domain}/`, domain, path: '/', name: 'SOCS', value: 'CAI', secure: true, sameSite: 'lax', expirationDate })
  })

// 1. A plain site first; it also creates the tab session, which then gets the consent cookie.
await call('openTab', 'https://example.com/')
const ex = await page((w) => w.url().startsWith('https://example.com'))
await settle(ex, 500)
check('example.com loads', (await ex.title()) === 'Example Domain', await ex.title())
await rejectConsent()

await call('openTab', 'https://en.wikipedia.org/wiki/Electron_(software_framework)')
const wiki = await page((w) => w.url().includes('wikipedia.org'))
await settle(wiki, 500)
check('wikipedia loads', /Electron/.test(await wiki.title()), await wiki.title())

// 2. YouTube watch page.
const ytProbe = () => {
  const d = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse')
  const r = window.ytInitialPlayerResponse
  const player = document.getElementById('movie_player')
  const live = player?.getPlayerResponse?.()
  return {
    url: location.href,
    title: document.title,
    video: !!document.querySelector('video'),
    trapped: !!(d && (d.get || d.set)), // set-constant installed its trap before YouTube's inline script assigned it
    videoId: r?.videoDetails?.videoId ?? null,
    adPlacements: r ? (Array.isArray(r.adPlacements) ? r.adPlacements.length : String(r.adPlacements)) : 'no response',
    playerAds: r ? (Array.isArray(r.playerAds) ? r.playerAds.length : String(r.playerAds)) : 'no response',
    livePlayerAds: live ? (Array.isArray(live.adPlacements) ? live.adPlacements.length : String(live.adPlacements)) : 'no player',
    adShowing: !!player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
  }
}
const csp = (resp) => {
  const h = resp?.headers() ?? {}
  const v = [h['content-security-policy'], h['content-security-policy-report-only'] && 'report-only: ' + h['content-security-policy-report-only']].filter(Boolean).join(' || ')
  return { trustedTypes: /require-trusted-types-for/.test(h['content-security-policy'] ?? ''), csp: v.slice(0, 160) }
}
await call('openTab', WATCH)
const yt = await page((w) => /youtube\.com\/watch/.test(w.url()) || /consent\.youtube/.test(w.url()))
await settle(yt, 6000)
let y = await yt.evaluate(ytProbe)
// Sampled on the first load: the count restarts at each navigation, and a reload (served partly from cache) can
// end up with nothing left to block.
const ytBlocked = await blockedFor(/youtube\.com\/watch/)
info('youtube', JSON.stringify(y))
// Reload once to read the page's own CSP (and that a second load behaves the same).
const ytCsp = csp(await yt.reload({ waitUntil: 'load', timeout: 30000 }).catch(() => null))
await sleep(6000)
y = await yt.evaluate(ytProbe)
info('youtube after reload', JSON.stringify(y), JSON.stringify(ytCsp))
check('youtube: not stuck on a consent page', !/consent\./.test(y.url), y.url)
check('youtube: page works (title, video element, player response)', /YouTube/.test(y.title) && y.video && y.videoId === videoId, `${y.title} video=${y.video} id=${y.videoId}`)
check('youtube: set-constant ran before page scripts (trap on ytInitialPlayerResponse)', y.trapped)
check('youtube: ad slots removed from the player response, no ad playing', y.adPlacements === 'undefined' && y.playerAds === 'undefined' && !y.adShowing, `adPlacements=${y.adPlacements} playerAds=${y.playerAds} player=${y.livePlayerAds} adShowing=${y.adShowing}`)
const ytFrame = (await frames()).find((f) => /youtube\.com\/watch/.test(f.url))
check('youtube: preload received scriptlets', (ytFrame?.scripts ?? 0) > 0, `scripts=${ytFrame?.scripts} css=${ytFrame?.css}B`)
check('youtube: blocked count increases', ytBlocked > 0, `blocked=${ytBlocked} on the first load`)

// 3. Test page: cosmetic hiding (first stylesheet and the later DOM-driven rules) and the YouTube player in an iframe.
await call('openTab', EMBED_PAGE)
const emb = await page((w) => w.url().startsWith(EMBED_PAGE))
await settle(emb, 5000)
const visibility = () => {
  const d = (el) => (el ? getComputedStyle(el).display : 'missing')
  return { content: d(document.getElementById('content')), baseRule: d(document.getElementById('base')), idRule: d(document.getElementById('AdSense1')), classRule: d(document.querySelector('.sponsored-ad')), addedLater: d(document.getElementById('late')) }
}
const vis = await emb.evaluate(visibility)
check('cosmetics: base, id, class and later-added ads hidden, content stays', vis.content === 'block' && [vis.baseRule, vis.idRule, vis.classRule, vis.addedLater].every((v) => v === 'none'), JSON.stringify(vis))
const embedFrame = emb.frames().find((f) => /youtube\.com\/embed/.test(f.url()))
const e = embedFrame ? await embedFrame.evaluate(() => ({ trapped: !!Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse')?.get, video: !!document.querySelector('video') })) : null
const embReq = (await frames()).find((f) => /youtube\.com\/embed/.test(f.url))
check('embedded player (iframe) got the scriptlets at its document start', !!e?.trapped && (embReq?.scripts ?? 0) > 0, JSON.stringify({ ...e, scripts: embReq?.scripts }))

// 4. Google: home page, then a search. Under Playwright, navigator.webdriver is true and Google answers searches with
// its "unusual traffic" page (/sorry/, a CAPTCHA) whatever the build; that is reported, never worked around.
const gProbe = () => ({
  url: location.href,
  title: document.title,
  webdriver: navigator.webdriver,
  searchBox: !!document.querySelector('textarea[name=q], input[name=q]'),
  results: document.querySelectorAll('#search a h3, #rso a h3').length,
  rwtTrapped: !!Object.getOwnPropertyDescriptor(window, 'rwt')?.get // +js(set, rwt, noopFunc): no click-tracking rewrite
})
await call('openTab', 'https://www.google.com/?hl=en')
const gh = await page((w) => /^https:\/\/www\.google\.com\/\?hl/.test(w.url()) || /consent\.google/.test(w.url()))
await settle(gh, 2000)
const ghCsp = csp(await gh.reload({ waitUntil: 'load', timeout: 30000 }).catch(() => null))
await sleep(1500)
const h = await gh.evaluate(gProbe)
info('google home', JSON.stringify(h), JSON.stringify(ghCsp))
check('google home: page works', h.title === 'Google' && h.searchBox, `${h.title} searchBox=${h.searchBox}`)
check('google home: set-constant ran (trap on rwt)', h.rwtTrapped)
const ghFrame = (await frames()).find((f) => /^https:\/\/www\.google\.com\/\?hl/.test(f.url))
check('google home: preload received scriptlets', (ghFrame?.scripts ?? 0) > 0, `scripts=${ghFrame?.scripts} css=${ghFrame?.css}B`)

await call('openTab', SEARCH)
const g = await page((w) => /google\.[a-z.]+\/(search|sorry)/.test(w.url()) || /consent\.google/.test(w.url()))
await settle(g, 3000)
const gr = await g.evaluate(gProbe)
info('google search', JSON.stringify({ ...gr, url: gr.url.slice(0, 90) }))
check('google search: not stuck on a consent page', !/consent\./.test(gr.url), gr.url.slice(0, 90))
if (/\/sorry\//.test(gr.url)) console.log(`SKIP google search: results page - Google served its automated-traffic check (webdriver=${gr.webdriver})`)
else check('google search: results page works', /laptop/i.test(gr.title) && gr.results > 0, `${gr.title} results=${gr.results}`)
check('google search: set-constant ran (trap on rwt)', gr.rwtTrapped)
const gFrame = (await frames()).find((f) => /google\.[a-z.]+\/(search|sorry)/.test(f.url))
check('google search: preload received scriptlets', (gFrame?.scripts ?? 0) > 0, `scripts=${gFrame?.scripts} css=${gFrame?.css}B`)
info(`google search blocked=${await blockedFor(/google\.[a-z.]+\/(search|sorry)/)} (Google serves search ads first-party, so often 0)`)

// 5. A second session (the private space has its own in-memory partition): same scriptlets there.
await call('run', 'privateSpace')
await call('closeOverlay')
await call('openTab', 'https://example.com/?private')
await settle(await page((w) => w.url().includes('example.com/?private')), 500)
await rejectConsent()
await call('openTab', WATCH + '&solamar=private')
const pv = await page((w) => w.url().includes('solamar=private'))
await settle(pv, 6000)
const p = await pv.evaluate(ytProbe)
const pvReq = (await frames()).find((f) => f.url.includes('solamar=private'))
const sessions = await app.evaluate(({ webContents }) => new Set(webContents.getAllWebContents().filter((w) => /^https?:/.test(w.getURL())).map((w) => w.session)).size)
check('second session (private space): scriptlets run, no ad', p.trapped && !p.adShowing && p.adPlacements === 'undefined' && (pvReq?.scripts ?? 0) > 0, `sessions=${sessions} trapped=${p.trapped} adShowing=${p.adShowing} adPlacements=${p.adPlacements} scripts=${pvReq?.scripts}`)

// 6. Control: ad blocking off -> the preload gets nothing and YouTube's player response keeps its ad slots.
await call('updateSettings', { adblock: { enabled: false } })
const before = (await frames()).length
await call('openTab', WATCH + '&solamar=off')
const off = await page((w) => w.url().includes('solamar=off'))
await settle(off, 5000)
const o = await off.evaluate(ytProbe)
const offReplies = (await frames()).slice(before).filter((f) => /youtube\.com\/watch/.test(f.url))
info('youtube, blocking off', JSON.stringify(o))
check('blocking off: no scriptlets sent and no trap', offReplies.every((f) => f.scripts === null) && !o.trapped, `replies=${JSON.stringify(offReplies)}`)
info(`blocking off: adPlacements=${o.adPlacements} playerAds=${o.playerAds} (a number here shows the ads that blocking removes)`)
await call('updateSettings', { adblock: { enabled: true } })

// 7. A site on the allowlist ("ads allowed here"): nothing injected, in its iframes either.
await call('updateSettings', { adblock: { allowlist: [TEST_HOST] } })
const before2 = (await frames()).length
await call('openTab', EMBED_PAGE + '?allowed')
const al = await page((w) => w.url().includes('?allowed'))
await settle(al, 4000)
const alVis = await al.evaluate(visibility)
const alReplies = (await frames()).slice(before2)
check('allowlisted site: no hiding, no scriptlets (iframes included)', alVis.idRule === 'block' && alVis.baseRule !== 'none' && alReplies.length > 0 && alReplies.every((f) => f.scripts === null), JSON.stringify({ ...alVis, replies: alReplies.map((f) => `${f.url.slice(0, 40)}:${f.scripts}`) }))
await call('updateSettings', { adblock: { allowlist: [] } })

// 8. No scriptlet errors reached the main process.
const rej = await rejections()
const failed = rej.filter((m) => /Script failed to execute/.test(m))
const errLines = stderr.join('').split('\n').filter((l) => /Script failed to execute|unhandled rejection|\[adblock\]/.test(l))
check('no "Script failed to execute" rejections in main', failed.length === 0 && errLines.length === 0, `rejections=${rej.length} failed=${failed.length} stderr=${errLines.slice(0, 3).join(' | ')}`)

clearTimeout(guard)
await app.close()
srv.close()
const ok = results.every(Boolean)
console.log(ok ? `PASS all ${results.length} checks` : `FAIL ${results.filter((r) => !r).length} of ${results.length} checks`)
process.exit(ok ? 0 : 1)
