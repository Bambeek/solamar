// Real run of the page agent on the user's Claude Code plan (personal builds): tiny task, Haiku, a spare port.
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const site = createServer((q, r) => (r.writeHead(200, { 'content-type': 'text/html' }), r.end('<title>Form</title><label>Name <input id=name name=name></label>')))
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${site.address().port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
let ui
for (let i = 0; i < 100 && !ui; i++) (ui = app.windows().find((w) => w.url().endsWith('#ui'))) || (await sleep(200))
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true, ai: { enabled: true, engine: 'claude-code', claudeCodeModel: 'haiku' }, agent: { port: 47977 } })
await call('openTab', base + '/form')
await sleep(1500)
await ui.evaluate(() => void window.solamar.call('agentRun', 'Type "Grace Hopper" into the Name field. Do nothing else. (My favourite colour is teal, remember that.)'))
let s
for (let t = 0; t < 150; t++) {
  s = await call('state')
  if (s.pageAgent && !s.pageAgent.running) break
  await sleep(1000)
}
const page = app.windows().find((w) => w.url() === base + '/form')
const v = await page.inputValue('#name')
console.log(JSON.stringify({ error: s.pageAgent?.error, text: s.pageAgent?.text?.slice(0, 300), steps: s.agent.log.filter((x) => x.at >= s.pageAgent.since).map((x) => `${x.tool}:${x.outcome}`), serving: s.agent.serving, value: v }, null, 1))
console.log(v === 'Grace Hopper' ? 'PASS Claude Code agent typed into the page' : 'FAIL')
console.log(!s.agent.serving ? 'PASS local server closed again after the run' : 'FAIL server still on')

// A follow-up remembers the conversation: the colour is nowhere on the page, only in the first request.
await ui.evaluate(() => void window.solamar.call('agentRun', 'What is my favourite colour? Answer with one word, no tools needed.'))
for (let t = 0; t < 150; t++) {
  s = await call('state')
  if (s.pageAgent?.task.startsWith('What is my favourite') && !s.pageAgent.running) break
  await sleep(1000)
}
console.log(JSON.stringify({ error: s.pageAgent?.error, text: s.pageAgent?.text?.slice(0, 200), earlier: s.pageAgent?.earlier?.length }))
console.log(/teal/i.test(s.pageAgent?.text ?? '') ? 'PASS the follow-up remembers the earlier request' : 'FAIL no memory of the earlier request')
await app.close()
site.close()
