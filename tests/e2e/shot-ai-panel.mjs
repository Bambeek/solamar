// Screenshots of the AI panel from a hidden window, against a scripted stand-in for the Anthropic API: Ask with a
// Markdown answer, and Do it for me with a two-turn conversation. Writes ask-empty, ask, do-empty, do-running and
// do PNGs (the panel only). Usage: node tests/e2e/shot-ai-panel.mjs <userDataDir> <outDir>
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const [userData, outDir] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ASK_ANSWER =
  'This is **r/ArcBrowser**, a community for people who use Arc.\n\n- The top post asks what to use **after Arc** ends in December\n- Several people mention vertical tabs and spaces\n- One thread compares Zen, Dia and Vivaldi'
const FIND_ANSWER =
  'Looking at the page.\n\nI found three places where a post about Solamar fits:\n\n1. **r/ArcBrowser**, people leaving Arc (25k weekly visitors)\n2. **r/browsers**, browser news and reviews\n3. **r/software**, new apps, self-promotion on Saturdays\n\nWant me to join them?'
const JOIN_ANSWER = 'Joined **r/ArcBrowser** and **r/browsers**. r/software only lets you post on Saturdays, so I left it for now.'
let hold = false

const sse = (res, model, blocks, stop) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  send('message_start', { message: { id: 'msg', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else {
      send('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    send('content_block_stop', { index })
  })
  send('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } })
  send('message_stop', {})
  res.end()
}
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    if (req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false }))
    }
    if (req.url.startsWith('/v1/messages')) {
      const b = JSON.parse(body)
      if (hold) return setTimeout(() => sse(res, b.model, [{ type: 'text', text: 'Done.' }], 'end_turn'), 6000) // a run still going, for the "working" shot
      if (!b.tools) return sse(res, b.model, [{ type: 'text', text: ASK_ANSWER }], 'end_turn')
      const tab = /tab "([^"]+)"/.exec(b.system)?.[1]
      const last = b.messages[b.messages.length - 1]
      const results = Array.isArray(last.content) ? last.content.filter((c) => c.type === 'tool_result') : []
      const task = [...b.messages].reverse().find((m) => typeof m.content === 'string')?.content ?? ''
      if (!results.length) return sse(res, b.model, [{ type: 'text', text: 'Reading the page.' }, { type: 'tool_use', id: 'tu1', name: 'page_snapshot', input: { tab } }], 'tool_use')
      if (results[0].tool_use_id === 'tu1' && /join/i.test(task)) return sse(res, b.model, [{ type: 'text', text: 'Joining.\n' }, { type: 'tool_use', id: 'tu2', name: 'page_snapshot', input: { tab } }], 'tool_use')
      return sse(res, b.model, [{ type: 'text', text: /join/i.test(task) ? JOIN_ANSWER : FIND_ANSWER.replace('Looking at the page.\n\n', '') }], 'end_turn')
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>r/ArcBrowser</title><h1>r/ArcBrowser</h1><p>The Arc feature that I will miss the most... any replacements?</p><button>Join</button>')
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, SOLAMAR_ANTHROPIC_BASE_URL: base } })
let ui
for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
await ui.waitForLoadState('domcontentloaded')
await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1280, height: 760 }))
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const state = () => call('state')
await app.evaluate(({ nativeTheme }) => void (nativeTheme.themeSource = 'dark'))
await call('updateSettings', { onboarded: true, ai: { enabled: true, engine: 'anthropic' } })
await call('setAnthropicKey', 'sk-ant-test-local-mock')
const sp = (await state()).spaces[0].id
await call('updateSpace', sp, { theme: { color: '#7c6cf2', mode: 'dark', texture: 'none', intensity: 0.7 } })
await call('openTab', base + '/r/ArcBrowser')
await sleep(1200)
await call('aiPanel', true)
await ui.addStyleTag({ content: '*, :root { transition: none !important; animation-duration: 0s !important; caret-color: transparent !important; }' })

const shot = async (name) => {
  await sleep(500)
  const box = await ui.locator('.ai-panel').boundingBox()
  await ui.screenshot({ path: join(outDir, `${name}.png`), clip: box })
  console.log('shot', name)
}
const waitDone = async () => {
  for (let i = 0; i < 100; i++) {
    const s = await state()
    if (s.pageAgent && !s.pageAgent.running) return
    await sleep(150)
  }
}

await shot('ask-empty')
await call('aiAsk', 'What is this page about?')
for (let i = 0; i < 60 && (await state()).ai.busy; i++) await sleep(150)
await shot('ask')

await ui.getByRole('tab', { name: 'Do it for me' }).click()
await shot('do-empty')
await call('agentRun', 'Find subreddits where I can post about Solamar')
await waitDone()
await call('agentRun', 'Join these groups')
await waitDone()
await shot('do')
hold = true
await ui.evaluate(() => void window.solamar.call('agentRun', 'Open r/ArcBrowser and write a short post draft'))
await sleep(1200)
await shot('do-running')
hold = false

await app.close()
server.close()
