// Write with AI and AI search help, against mock engines (plus one optional real Claude Code call).
// Usage: node tests/e2e/assist.mjs <userDataDir> <outDir> [--real-claude-code]
import { mkdirSync } from 'node:fs'
import { _electron as electron } from 'playwright'
import { startMockAnthropic } from './mock-anthropic.mjs'
import { startMockOllama } from './mock-ollama.mjs'

const [userData, outDir, flag] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const anth = await startMockAnthropic()
const ollama = await startMockOllama()
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, SOLAMAR_ANTHROPIC_BASE_URL: anth.url } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith('#' + h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('ui'), overlay = await page('overlay')
await ui.waitForLoadState('domcontentloaded')
for (const [n, p] of [['ui', ui], ['overlay', overlay]]) p.on('pageerror', (e) => console.log('PAGEERROR', n, e.message))
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const state = () => call('state')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150) } return false }
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

await call('updateSettings', { onboarded: true, ai: { enabled: true, engine: 'ollama', host: ollama.url } })
await call('aiStatus')
await call('openTab', anth.url + '/form')
await sleep(1500)
const tab = app.windows().find((w) => w.url().endsWith('/form'))

// ---- Write with AI: whole field
await tab.evaluate(() => { const t = document.querySelector('textarea'); t.value = 'helo wrld'; t.focus() })
await call('run', 'aiWrite')
await until(async () => (await state()).write)
let s = await state()
check('dialog opens on the focused field', s.overlay?.kind === 'write' && s.write?.original === 'helo wrld' && s.write?.scope === 'field', JSON.stringify(s.write))
await call('aiWriteRun', 'fix', '')
await until(async () => { const w = (await state()).write; return w && !w.busy && w.result })
s = await state()
check('rewrite streams from the engine', s.write.result.startsWith('Gist: an example page.'), JSON.stringify(s.write.result))
await sleep(300)
await overlay.screenshot({ path: `${outDir}/write-dialog.png` })
await call('aiWriteApply')
await sleep(400)
const v1 = await tab.evaluate(() => document.querySelector('textarea').value)
check('Apply replaces the field text', v1.startsWith('Gist: an example page.') && (await state()).overlay === null, JSON.stringify(v1))
const undone = await tab.evaluate(() => { document.querySelector('textarea').focus(); document.execCommand('undo'); return document.querySelector('textarea').value })
check('Ctrl+Z (undo) brings the old text back', undone === 'helo wrld', JSON.stringify(undone))

// ---- selection only
await tab.evaluate(() => { const t = document.querySelector('input[name=name]'); t.value = 'Ada Lovelace rules'; t.focus(); t.setSelectionRange(4, 12) })
await call('aiWriteStart')
await until(async () => (await state()).write)
s = await state()
check('selection is used when there is one', s.write.scope === 'selection' && s.write.original === 'Lovelace')
await call('aiWriteRun', 'clearer', '')
await until(async () => { const w = (await state()).write; return w && !w.busy && w.result })
await call('aiWriteApply', 'Byron')
await sleep(400)
const v2 = await tab.evaluate(() => document.querySelector('input[name=name]').value)
check('only the selection is replaced (edited text kept)', v2 === 'Ada Byron rules', JSON.stringify(v2))

// ---- password fields never go to AI
await tab.evaluate(() => document.querySelector('input[type=password]').focus())
await call('aiWriteStart')
await until(async () => (await state()).write)
s = await state()
check('password field is refused', /never sends passwords/.test(s.write.error ?? '') && s.write.original === '')
await call('closeOverlay')

// ---- command bar: better search + answer (local model)
const better = await call('aiRewrite', 'how do i make my laptop battery last longer')
check('better search query comes back', typeof better === 'string' && better.length > 0, JSON.stringify(better))
check('single words get no AI rewrite', (await call('aiRewrite', 'weather')) === null)
await call('openOverlay', 'command', { mode: 'new' })
await overlay.fill('.command input', 'how do i make my laptop battery last longer')
await overlay.waitForSelector('.result.ai', { timeout: 5000 }).catch(() => {})
await sleep(1500)
const rowsText = await overlay.locator('.result').allTextContents()
check('Ask AI and Better search rows in the command bar', rowsText.some((t) => t.startsWith('Ask AI')) && rowsText.some((t) => t.includes('Better search')), rowsText.slice(0, 4).join(' | '))
await overlay.screenshot({ path: `${outDir}/command-ai-rows.png` })
await call('aiAnswer', 'how do i make my laptop battery last longer')
await until(async () => { const a = (await state()).answer; return a && !a.busy })
s = await state()
check('local answer shows, marked as from memory', s.answer.text.length > 0 && s.answer.web === false)
await sleep(300)
await overlay.screenshot({ path: `${outDir}/command-answer.png` })
await call('closeOverlay')
check('closing the command bar clears the answer', (await state()).answer === null)

// ---- answer through the Anthropic API uses web search
await call('setAnthropicKey', 'sk-ant-test-local-mock')
await call('updateSettings', { ai: { features: { search: 'anthropic' } } })
await call('aiAnswer', 'what is the latest version of Electron')
await until(async () => { const a = (await state()).answer; return a && !a.busy })
const req = anth.requests.at(-1)?.body
check('API answer requests the web search tool', req?.tools?.[0]?.type === 'web_search_20260209' && req?.model === 'claude-opus-5-5', JSON.stringify(req?.tools))
check('API answer is marked as web', (await state()).answer.web === true && (await state()).answer.text.includes('Claude mock'))
await call('aiAnswerClear')

// ---- one real call through the user's Claude Code (their plan)
if (flag === '--real-claude-code') {
  await call('updateSettings', { ai: { engine: 'claude-code', claudeCodeModel: 'haiku', features: { search: null } } })
  await tab.evaluate(() => { const t = document.querySelector('textarea'); t.value = 'i has a apple'; t.focus() })
  await call('aiWriteStart')
  await until(async () => (await state()).write)
  const t0 = Date.now()
  await call('aiWriteRun', 'fix', '')
  await until(async () => { const w = (await state()).write; return w && !w.busy }, 90000)
  s = await state()
  check('Claude Code engine (your plan) fixes text', !s.write.error && /an apple/i.test(s.write.result), `${Date.now() - t0} ms: ${JSON.stringify(s.write.result || s.write.error)}`)
  await call('closeOverlay')
}

await app.close()
anth.server.close()
ollama.server.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
