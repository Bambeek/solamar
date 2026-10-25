// The approval card must sit above the page Claude Code is working in. Checks the real view order in the window
// while an approval is pending with the agent's tab on screen.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { _electron as electron } from 'playwright'
import { startMockAnthropic } from './mock-anthropic.mjs'

const [userData] = process.argv.slice(2)
const mock = await startMockAnthropic()
const PORT = 48100 + Math.floor(Math.random() * 800)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData, SOLAMAR_APPROVAL_WAIT_MS: '4000' } })
const page = async (h) => { for (;;) { const p = app.windows().find((w) => w.url().endsWith('#' + h)); if (p) return p; await new Promise((r) => setTimeout(r, 200)) } }
const ui = await page('ui')
await ui.waitForLoadState('domcontentloaded')
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
await call('updateSettings', { onboarded: true, agent: { mcpEnabled: true, port: PORT } })
await new Promise((r) => setTimeout(r, 500))
const secret = /Bearer ([^"]+)"/.exec((await call('state')).agent.command)[1]
const client = new Client({ name: 'zorder', version: '1' })
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }))

const order = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].contentView.children.map((v) => { try { return v.webContents.getURL().replace(/^https?:\/\/[^/]+/, '') } catch { return '?' } }))

const opened = await client.callTool({ name: 'tab_open', arguments: { url: mock.url + '/form', show: true } })
const tab = /Opened tab (\S+):/.exec(opened.content[0].text)[1]
console.log('after tab_open(show):', JSON.stringify(await order()))
const snap = (await client.callTool({ name: 'page_snapshot', arguments: { tab } })).content[0].text
const send = /\[(e\d+)\][^\n]*"Send/.exec(snap)[1]
const pending = client.callTool({ name: 'click', arguments: { tab, ref: send } })
await new Promise((r) => setTimeout(r, 1500))
const o = await order()
const top = o[o.length - 1]
console.log('while approval pending:', JSON.stringify(o))
console.log(top.endsWith('#overlay') ? 'PASS approval card view is on top' : `FAIL top view is ${top}`)
await pending
await client.close()
await app.close()
mock.server.close()
