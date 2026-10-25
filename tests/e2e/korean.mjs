// Korean input and data, for a user who asked on Reddit:
// 1. Command bar with an IME: Enter or Esc while a Hangul syllable is still being composed must only finish (or
//    cancel) the syllable, not run a search, open a tab or close the bar. Composition comes from Chromium's own IME
//    calls (DevTools protocol), the keys as Windows IMEs send them (key "Process", code 229) and as Chromium on macOS
//    sends them (Enter with isComposing).
// 2. Arc spaces and Chrome bookmark folders with Korean names, from a profile under a Korean Windows user name,
//    keep their names through an import and a restart.
// Usage: node tests/e2e/korean.mjs <userDataDir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

// A Windows profile under a Korean user name, with Arc and Chrome data named in Korean.
const home = join(tmpdir(), `김민준-${Date.now()}`)
const local = join(home, 'AppData', 'Local')
const arcDir = join(local, 'Packages', 'TheBrowserCompany.Arc_test', 'LocalCache', 'Local', 'Arc')
mkdirSync(arcDir, { recursive: true })
const ARC = { Work: '업무', Fun: '취미 생활', Research: '연구 자료', Deep: '깊은 폴더', 'My doc': '내 문서' }
let arc = readFileSync('tests/fixtures/arc-sidebar.json', 'utf-8')
for (const [en, ko] of Object.entries(ARC)) arc = arc.replace(`"title": "${en}"`, `"title": "${ko}"`)
writeFileSync(join(arcDir, 'StorableSidebar.json'), arc)
const chrome = join(local, 'Google', 'Chrome', 'User Data')
mkdirSync(join(chrome, 'Default'), { recursive: true })
writeFileSync(join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: '개인' } }, last_used: 'Default' } }))
const CHROME = { Research: '연구', Recipes: '요리법', Nested: '하위 폴더', Docs: '문서' }
let bm = readFileSync('tests/fixtures/importers/chromium-Bookmarks.json', 'utf-8')
for (const [en, ko] of Object.entries(CHROME)) bm = bm.replaceAll(`"name": "${en}"`, `"name": "${ko}"`)
writeFileSync(join(chrome, 'Default', 'Bookmarks'), bm)

const site = createServer((q, r) => (r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), r.end('<title>한국어 페이지</title><p>안녕하세요</p>')))
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const env = { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, LOCALAPPDATA: local, APPDATA: join(home, 'AppData', 'Roaming') }
const launch = async () => {
  const app = await electron.launch({ args: ['.', '--mute-audio'], env })
  let ui
  for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
  await ui.waitForLoadState('domcontentloaded')
  return { app, ui, call: (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a]) }
}

// ---------- 1. IME in the command bar ----------
let { app, call } = await launch()
await call('updateSettings', { onboarded: true })
await call('openTab', `http://127.0.0.1:${site.address().port}/`)
await sleep(1200)
const tabs = async () => (await call('state')).items.filter((i) => i.kind === 'tab').length
const before = await tabs()
await call('run', 'newTab')
let ov
for (let i = 0; i < 50 && !ov; i++) (ov = app.windows().find((w) => w.url().endsWith('#overlay'))) || (await sleep(100))
const input = ov.locator('.command-input input')
await input.waitFor()
await input.focus()
const cdp = await ov.context().newCDPSession(ov)
const key = (type, key, code, keyCode) => cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
const overlay = async () => (await call('state')).overlay?.kind ?? null

await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
await cdp.send('Input.insertText', { text: '한' })
await cdp.send('Input.imeSetComposition', { text: '국', selectionStart: 1, selectionEnd: 1 })
// macOS-style: Enter arrives as Enter while the syllable is still composing.
await key('rawKeyDown', 'Enter', 'Enter', 13)
await key('keyUp', 'Enter', 'Enter', 13)
await sleep(700)
check('Enter while composing (isComposing) does not run the search', (await overlay()) === 'command' && (await tabs()) === before, `overlay=${await overlay()} tabs=${await tabs()}`)
// Windows-style: the IME takes the key, the page sees key "Process" with code 229.
await key('rawKeyDown', 'Process', 'Enter', 229)
await key('keyUp', 'Enter', 'Enter', 13)
await sleep(500)
check('Enter taken by a Windows IME does not run the search', (await overlay()) === 'command' && (await tabs()) === before)
await key('rawKeyDown', 'Process', 'Escape', 229)
await key('keyUp', 'Escape', 'Escape', 27)
await sleep(500)
check('Esc taken by a Windows IME does not close the command bar', (await overlay()) === 'command', `overlay=${await overlay()}`)
await cdp.send('Input.insertText', { text: '국' })
await sleep(200)
check('the finished syllables stay in the field', (await input.inputValue()) === '한국', JSON.stringify(await input.inputValue()))
await key('rawKeyDown', 'Enter', 'Enter', 13)
await key('char', 'Enter', 'Enter', 13)
await key('keyUp', 'Enter', 'Enter', 13)
let opened = null
for (let i = 0; i < 30 && !opened; i++) {
  const s = await call('state')
  opened = s.items.filter((i) => i.kind === 'tab').find((t) => /한국/.test(decodeURIComponent(t.url ?? '')))
  if (!opened) await sleep(200)
}
check('Enter after composing searches for the whole word', !!opened, opened?.url)
await app.close()

// ---------- 2. Korean names through import and restart ----------
;({ app, call } = await launch())
const scan = await call('arcScan')
check('Arc found under a Korean user folder', scan.found === true && !scan.error, JSON.stringify(scan).slice(0, 200))
await call('arcImport', { includeToday: true })
const sources = await call('browserSources')
const ko = sources.find((s) => s.browser === 'chrome' && s.profileName === '개인')
check('Chrome profile named 개인 is listed by its name', !!ko, JSON.stringify(sources.map((s) => s.profileName)))
if (ko) await call('browserImport', ko.i, { bookmarks: true, history: false })
const names = (s) => [...s.spaces.map((x) => x.title), ...s.items.filter((i) => i.kind === 'folder').map((i) => i.title), ...s.items.map((i) => i.title ?? '')].filter(Boolean)
const want = [...Object.values(ARC).filter((t) => t !== '내 문서'), ...Object.values(CHROME).filter((t) => t !== '문서')]
const first = names(await call('state'))
const missing1 = want.filter((t) => !first.includes(t))
check('imported Korean space and folder names show as written', missing1.length === 0, 'missing: ' + missing1.join(', '))
await app.close()

;({ app, call } = await launch())
const second = names(await call('state'))
const missing2 = want.filter((t) => !second.includes(t))
check('after a restart every Korean name is unchanged', missing2.length === 0 && want.every((t) => second.filter((x) => x === t).length === first.filter((x) => x === t).length), 'missing: ' + missing2.join(', '))
const file = readFileSync(join(userData, 'solamar.json'), 'utf-8')
check('the settings file holds them as UTF-8 text', want.every((t) => file.includes(t)))
await app.close()
site.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
