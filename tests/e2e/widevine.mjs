// DRM video must play: castLabs' Electron installs Google's Widevine module through the component updater, and a
// page on localhost (a secure context, which EME needs) plays Shaka's Widevine test stream through Shaka's test
// license proxy. Needs the network (the module, the stream and the player script). Muted.
// Started as a plain process and driven over CDP: under Playwright's Electron launcher castLabs' build registers no
// components at all, so the module never installs there.
// Usage: node tests/e2e/widevine.mjs <userDataDir> [packaged Solamar executable; default: this checkout's build]
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import electronPath from 'electron'
import { chromium } from 'playwright'
const [userData, exe] = process.argv.slice(2)

const page = `<!doctype html><title>drm</title><video id="v" muted width="320"></video>
<script src="https://cdn.jsdelivr.net/npm/shaka-player@4.3.6/dist/shaka-player.compiled.js"></script>
<script>
  window.drm = { state: 'loading' }
  ;(async () => {
    try {
      const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
        initDataTypes: ['cenc'],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
      }])
      drm.keySystem = access.keySystem
      shaka.polyfill.installAll()
      const player = new shaka.Player(document.getElementById('v'))
      player.configure({ drm: { servers: { 'com.widevine.alpha': 'https://cwip-shaka-proxy.appspot.com/no_auth' } } })
      player.addEventListener('error', (e) => { drm.state = 'error'; drm.error = String(e.detail && e.detail.code) })
      await player.load('https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd')
      await document.getElementById('v').play()
      drm.state = 'playing'
    } catch (e) {
      drm.state = 'error'
      drm.error = String(e && (e.code || e.message || e))
    }
  })()
</script>`
const site = createServer((_q, r) => (r.writeHead(200, { 'content-type': 'text/html' }), r.end(page)))
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const url = `http://localhost:${site.address().port}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

const cdpPort = 9300 + Math.floor(Math.random() * 600)
const proc = spawn(exe ?? electronPath, [...(exe ? [] : ['.']), '--mute-audio', `--remote-debugging-port=${cdpPort}`], {
  env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData },
})
let log = ''
proc.stdout.on('data', (d) => (log += d))
proc.stderr.on('data', (d) => (log += d))
let browser
try {
  for (let i = 0; i < 100 && !browser; i++) browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`).catch(() => sleep(200).then(() => null))
  const pages = () => browser.contexts().flatMap((c) => c.pages())
  let ui
  for (let i = 0; i < 100 && !ui; i++) (ui = pages().find((p) => p.url().endsWith('#ui'))) || (await sleep(200))
  await ui.waitForLoadState('domcontentloaded')
  const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
  await call('updateSettings', { onboarded: true })

  // A first launch downloads the module; index.ts logs the component status once it is in.
  for (let i = 0; i < 120 && !/\[solamar\] widevine \{/.test(log); i++) await sleep(500)
  const line = (log.match(/\[solamar\] widevine (.*)/) ?? [])[1] ?? ''
  check('Widevine module installed', /Widevine Content Decryption Module/.test(line) && /"status":"(updated|up-to-date)"/.test(line), line || log.slice(-400))

  await call('openTab', url)
  let tab
  for (let i = 0; i < 50 && !tab; i++) (tab = pages().find((p) => p.url() === url)) || (await sleep(200))
  let drm = { state: 'no tab' }
  for (let i = 0; i < 60 && tab; i++) {
    drm = await tab.evaluate(() => ({ ...window.drm, time: document.getElementById('v')?.currentTime ?? 0 })).catch(() => drm)
    if (drm.state === 'error' || drm.time > 2) break
    await sleep(500)
  }
  check('the page sees the Widevine key system', drm.keySystem === 'com.widevine.alpha', JSON.stringify(drm))
  check('the encrypted test stream plays', drm.state === 'playing' && drm.time > 2, JSON.stringify(drm))
} finally {
  await browser?.close().catch(() => {})
  proc.kill()
  site.close()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`)
process.exit(failed ? 1 : 0)
