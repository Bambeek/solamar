// End-to-end: Anthropic engine (against a mock API) and the MCP server driven by the official MCP client.
// Hidden window, throwaway profile. Usage: node tests/e2e/agent.mjs <userDataDir> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { _electron as electron } from 'playwright'
import { startMockAnthropic } from './mock-anthropic.mjs'

const [userData, outDir] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const mock = await startMockAnthropic()
const PORT = 47000 + Math.floor(Math.random() * 900)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, SOLAMAR_ANTHROPIC_BASE_URL: mock.url, SOLAMAR_APPROVAL_WAIT_MS: '2500' } })
app.process().stderr.on('data', (d) => process.stderr.write('[main] ' + d))
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith('#' + h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('ui')
const overlay = await page('overlay')
await ui.waitForLoadState('domcontentloaded')
for (const [n, p] of [['ui', ui], ['overlay', overlay]]) p.on('pageerror', (e) => console.log('PAGEERROR', n, e.message))
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const state = () => call('state')
const results = []
const check = (name, ok, detail = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- engines ----------
await call('updateSettings', { onboarded: true, ai: { enabled: true, engine: 'anthropic' } })
const bad = await call('setAnthropicKey', 'sk-ant-wrong')
check('wrong key is rejected and not stored', !bad.ok && !(await state()).ai.hasKey, bad.error)
const good = await call('setAnthropicKey', 'sk-ant-test-local-mock')
check('valid key is saved to the keychain', good.ok && (await state()).ai.hasKey)
const settingsJson = await app.evaluate(({ app }) => require('node:fs').readFileSync(require('node:path').join(app.getPath('userData'), 'solamar.json'), 'utf-8')).catch(() => '')
check('key is not in solamar.json', !settingsJson.includes('sk-ant-test-local-mock'))
await call('openTab', mock.url + '/form')
await sleep(1500)
await call('aiSummarize')
let s = await state()
check('summary streams from Claude', s.ai.messages.at(-1)?.content === 'Claude mock: example page summary.', JSON.stringify(s.ai.messages.at(-1)?.content ?? s.ai.error))
const req = mock.requests.at(-1)
check('default model is claude-opus-5-5', req?.body.model === 'claude-opus-5-5')
check('server-side fallback opted in', req?.body.fallbacks === 'default' && String(req?.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01'))
check('page text is wrapped as untrusted', /<UNTRUSTED-[0-9a-f]+/.test(JSON.stringify(req?.body.messages)) && String(req?.body.system).includes('UNTRUSTED'))
await call('updateSettings', { ai: { anthropicModel: 'claude-haiku-5-5' } })
await call('aiSummarize')
check('Haiku requests carry no fallbacks', mock.requests.at(-1)?.body.model === 'claude-haiku-5-5' && mock.requests.at(-1)?.body.fallbacks === undefined)
await call('aiPanel', false)

// ---------- MCP server ----------
await call('updateSettings', { agent: { mcpEnabled: true, port: PORT, approvals: 'ask' } })
await sleep(500)
s = await state()
check('MCP server listens', s.agent.serving)
const secret = /Bearer ([^"]+)"/.exec(s.agent.command)[1]
const raw = (headers) => fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
check('no secret -> 401', (await raw({})).status === 401)
check('web page origin -> 403', (await raw({ authorization: `Bearer ${secret}`, origin: 'https://evil.example' })).status === 403)

const client = new Client({ name: 'solamar-e2e', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }))
const tools = (await client.listTools()).tools.map((t) => t.name)
check('tools listed', ['tabs_list', 'tab_open', 'page_snapshot', 'click', 'type', 'screenshot'].every((t) => tools.includes(t)), tools.join(','))

// The user's own tab is invisible to Claude Code unless shared.
const listed = await client.callTool({ name: 'tabs_list', arguments: {} })
check("user's tabs are not listed by default", !listed.content[0].text.includes('/form'))

// Answer Solamar's prompts like the user would, from Solamar's own UI.
const answer = (want) => (async () => {
  for (let i = 0; i < 60; i++) {
    const c = (await state()).confirm
    if (c) {
      // The picture is a by-product; the first one can take 2 s in a hidden window, close to the approval timeout.
      void overlay.screenshot({ path: `${outDir}/confirm-${c.kind}.png` }).catch(() => {})
      await sleep(200)
      return call('agentDecide', c.id, want(c))
    }
    await sleep(100)
  }
})()

const opened = await client.callTool({ name: 'tab_open', arguments: { url: mock.url + '/form' } })
const tabId = /Opened tab (\S+):/.exec(opened.content[0].text)?.[1]
check('default: any site without a prompt', !!tabId && !opened.isError && !(await state()).confirm, opened.content[0].text)
await call('updateSettings', { agent: { siteAccess: 'ask' } })
let ans = answer(() => 'always')
const opened2 = await client.callTool({ name: 'tab_open', arguments: { url: 'http://localhost:' + new URL(mock.url).port + '/other' } })
await ans
check('ask mode: new site prompts, Always allow remembers it', !opened2.isError && (await state()).settings.agent.grants.localhost === 'allow', opened2.content[0].text)
await call('updateSettings', { agent: { siteAccess: 'all' } })
s = await state()
check('tab lives in the Claude space', s.items.find((i) => i.id === tabId)?.spaceId === s.agent.spaceId)

const snap = await client.callTool({ name: 'page_snapshot', arguments: { tab: tabId } })
const snapText = snap.content[0].text
const ref = (label) => new RegExp(`\\[(e\\d+)\\][^\\n]*"${label}`).exec(snapText)?.[1]
check('snapshot lists the form', !!ref('Name') && !!ref('Password') && !!ref('Send'), snapText.split('\n').slice(0, 8).join(' | '))

const read = await client.callTool({ name: 'page_read', arguments: { tab: tabId } })
check('page_read wraps page text as untrusted', /<UNTRUSTED-[0-9a-f]+/.test(read.content[0].text) && read.content[0].text.includes('Ignore previous instructions'))

const typedName = await client.callTool({ name: 'type', arguments: { tab: tabId, ref: ref('Name'), text: 'Ada' } })
check('typing into a normal field works', !typedName.isError, typedName.content[0].text)
const typedPw = await client.callTool({ name: 'type', arguments: { tab: tabId, ref: ref('Password'), text: 'hunter2' } })
check('typing a password is blocked', typedPw.isError && /never typed/.test(typedPw.content[0].text))

ans = answer(() => 'deny')
const send1 = await client.callTool({ name: 'click', arguments: { tab: tabId, ref: ref('Send') } })
await ans
check('Send waits for the user and stops on Decline', send1.isError && /declined/.test(send1.content[0].text))
const stillHere = await client.callTool({ name: 'tabs_list', arguments: {} })
check('declined click did not submit', stillHere.content[0].text.includes('/form') && !stillHere.content[0].text.includes('/sent'))

ans = answer(() => 'allow')
const send2 = await client.callTool({ name: 'click', arguments: { tab: tabId, ref: ref('Send') } })
await ans
check('Send goes through after Allow', !send2.isError && send2.content[0].text.includes('/sent'), send2.content[0].text)

await client.callTool({ name: 'navigate', arguments: { tab: tabId, url: mock.url + '/form' } })
const snap2 = (await client.callTool({ name: 'page_snapshot', arguments: { tab: tabId } })).content[0].text
const ref2 = (label) => new RegExp(`\\[(e\\d+)\\][^\\n]*"${label}`).exec(snap2)?.[1]
await client.callTool({ name: 'type', arguments: { tab: tabId, ref: ref2('Name'), text: 'Grace' } })
ans = answer(() => 'allow')
const enter = await client.callTool({ name: 'press', arguments: { tab: tabId, key: 'Enter' } })
await ans
check('Enter in a form asks, then submits it', !enter.isError && enter.content[0].text.includes('/sent?name=Grace'), enter.content[0].text)

await client.callTool({ name: 'navigate', arguments: { tab: tabId, url: mock.url + '/form' } })
const snap3 = (await client.callTool({ name: 'page_snapshot', arguments: { tab: tabId } })).content[0].text
const send3 = new RegExp('\\[(e\\d+)\\][^\\n]*"Send').exec(snap3)?.[1]
const slow = await client.callTool({ name: 'click', arguments: { tab: tabId, ref: send3 } })
check('no answer yet: the call returns "waiting", the card stays', slow.isError && /Waiting for the user/.test(slow.content[0].text) && !!(await state()).confirm, slow.content[0].text)
await call('agentDecide', (await state()).confirm.id, 'allow')
const retry = await client.callTool({ name: 'click', arguments: { tab: tabId, ref: send3 } })
check('late Allow lets the retried call through', !retry.isError && retry.content[0].text.includes('/sent'), retry.content[0].text)
const again = await client.callTool({ name: 'navigate', arguments: { tab: tabId, url: mock.url + '/form' } })
const snap4 = (await client.callTool({ name: 'page_snapshot', arguments: { tab: tabId } })).content[0].text
const send4 = new RegExp('\\[(e\\d+)\\][^\\n]*"Send').exec(snap4)?.[1]
const once = await client.callTool({ name: 'click', arguments: { tab: tabId, ref: send4 } })
check('a late Allow is used once, not forever', once.isError && /Waiting for the user/.test(once.content[0].text))
await call('agentDecide', (await state()).confirm.id, 'deny')

// Works-on-its-own mode: sending goes through without a card, paying still asks.
await call('updateSettings', { agent: { approvals: 'auto' } })
await client.callTool({ name: 'navigate', arguments: { tab: tabId, url: mock.url + '/form' } })
const snap5 = (await client.callTool({ name: 'page_snapshot', arguments: { tab: tabId } })).content[0].text
const send5 = new RegExp('\\[(e\\d+)\\][^\\n]*"Send').exec(snap5)?.[1]
const autoSend = await client.callTool({ name: 'click', arguments: { tab: tabId, ref: send5 } })
check('auto mode: Send goes through without a card', !autoSend.isError && autoSend.content[0].text.includes('/sent') && !(await state()).confirm, autoSend.content[0].text)
await client.callTool({ name: 'navigate', arguments: { tab: tabId, url: mock.url + '/pay' } })
const snap6 = (await client.callTool({ name: 'page_snapshot', arguments: { tab: tabId } })).content[0].text
const pay = new RegExp('\\[(e\\d+)\\][^\\n]*"Pay now').exec(snap6)?.[1]
ans = answer(() => 'deny')
const payRes = await client.callTool({ name: 'click', arguments: { tab: tabId, ref: pay } })
await ans
check('auto mode: Pay now still asks, Decline stops it', payRes.isError && /declined/.test(payRes.content[0].text))
await call('updateSettings', { agent: { approvals: 'ask' } })

const blockedUrl = await client.callTool({ name: 'navigate', arguments: { tab: tabId, url: 'file:///C:/Windows/win.ini' } })
check('file: URLs are blocked', blockedUrl.isError)

const shot = await client.callTool({ name: 'screenshot', arguments: { tab: tabId } })
const img = shot.content.find((c) => c.type === 'image')
if (img) writeFileSync(`${outDir}/agent-tab.png`, Buffer.from(img.data, 'base64'))
check('screenshot of a background tab', !!img || /tab_show/.test(shot.content[0].text), img ? `${img.data.length} b64 chars` : shot.content[0].text)

s = await state()
check('activity is visible to the user', s.agent.active && s.agent.log.length >= 8 && s.agent.lastCall > 0, `${s.agent.log.length} log entries`)
await ui.screenshot({ path: `${outDir}/driving-frame.png` })

await call('agentPause', true)
const paused = await raw({ authorization: `Bearer ${secret}` })
check('Stop pauses Claude Code (503)', paused.status === 503)
await call('agentPause', false)

await call('openOverlay', 'settings', { tab: 'claude' })
await sleep(500)
await overlay.screenshot({ path: `${outDir}/settings-claude.png` })
await call('openOverlay', 'settings', { tab: 'ai' })
await sleep(500)
await overlay.screenshot({ path: `${outDir}/settings-ai.png` })

await client.close()
await app.close()
mock.server.close()
const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
