// Records the gull in the AI panel's empty state from a hidden window (frames grabbed in the main process: idle, a
// click, a burst of clicks that makes it dizzy) as numbered PNGs for a GIF, and checks it reacts to clicks.
// Usage: node tests/e2e/shot-gull.mjs <userDataDir> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const [userData, outDir] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

// Just enough of the Anthropic API for the panel to count the engine as available.
const api = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'application/json' })
  r.end(JSON.stringify({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false }))
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, SOLAMAR_ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.address().port}` } })
let ui
for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
await ui.waitForLoadState('domcontentloaded')
await app.evaluate(({ BaseWindow, nativeTheme }) => {
  nativeTheme.themeSource = 'dark'
  BaseWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1280, height: 760 })
})
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true, ai: { enabled: true, engine: 'anthropic' } })
await call('setAnthropicKey', 'sk-ant-test-local-mock')
const sp = (await call('state')).spaces[0].id
await call('updateSpace', sp, { theme: { color: '#7c6cf2', mode: 'dark', texture: 'none', intensity: 0.7 } })
await call('aiPanel', true)
await ui.getByRole('tab', { name: 'Do it for me' }).click()
const gull = ui.locator('.ai-empty .gull')
await gull.waitFor()
await sleep(600)

const box = await ui.locator('.ai-panel').boundingBox()
const rect = { x: Math.round(box.x), y: Math.round(box.y + 96), width: Math.round(box.width), height: 380 }
// Grabs the panel ~20 times a second until told to stop, in the main process, while the test clicks.
const recording = app.evaluate(async ({ webContents }, rect) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL().endsWith('#ui'))
  globalThis.__frames = []
  globalThis.__recording = true
  while (globalThis.__recording) {
    globalThis.__frames.push((await wc.capturePage(rect)).toPNG().toString('base64'))
    await new Promise((r) => setTimeout(r, 30))
  }
}, rect)
const film = (ms) => sleep(ms)
const pose = () => ui.evaluate(() => document.querySelector('.ai-empty .gull-body img.on')?.getAttribute('src')?.split('/').pop())

await film(900)
await ui.evaluate(() => document.querySelector('.ai-empty .gull')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
await gull.dispatchEvent('click')
await sleep(60)
const after = await pose()
check('a click changes the pose', !/^base/.test(after ?? 'base'), after)
check('a click shows a speech bubble', (await ui.locator('.gull-says').count()) === 1, await ui.locator('.gull-says').innerText().catch(() => ''))
await film(1500)
for (let i = 0; i < 5; i++) await gull.dispatchEvent('click')
await sleep(60)
check('five quick clicks make it dizzy', /dizzy/.test((await pose()) ?? ''), await pose())
await film(2200)
await sleep(1200)
check('it goes back to resting', /^base|^blink/.test((await pose()) ?? ''), await pose())
await app.evaluate(() => void (globalThis.__recording = false))
await recording
const frames = await app.evaluate(() => globalThis.__frames)
frames.forEach((b64, i) => writeFileSync(join(outDir, `f${String(i).padStart(3, '0')}.png`), Buffer.from(b64, 'base64')))
console.log('frames', frames.length)
await app.close()
api.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
