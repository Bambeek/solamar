// Solamar's own page agent: does a task on the user's current tab with the same tools and guardrails Claude Code gets
// over MCP (agent.ts). With an API key it runs the tool loop here, talking to the tools in-process; with the user's
// Claude Code plan (personal builds) it runs `claude -p` against Solamar's local MCP server.
import { randomBytes } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { claudeCodeStream } from './claude-cli'
import { RefusalError } from './engines'
import { UNTRUSTED_RULE } from './guard'

const MAX_TURNS = 30

/** An earlier request in the same conversation and what the agent replied, so "join these" knows what "these" are. */
export interface AgentTurn {
  task: string
  url: string
  answer: string
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
const asked = (h: AgentTurn) => `(on ${h.url}) ${clip(h.task, 1000)}`

/** For an engine that takes one prompt: the conversation so far, then the new request. */
export function promptWithHistory(task: string, history: AgentTurn[]): string {
  if (!history.length) return task
  const earlier = history.map((h) => `User ${asked(h)}\nYou: ${clip(h.answer, 3000)}`).join('\n\n')
  return `Earlier in this conversation, oldest first:\n\n${earlier}\n\nThe user's new request: ${task}`
}

export function agentSystemPrompt(tab: { id: string; title: string; url: string }): string {
  return [
    `You are the page agent built into the Solamar browser. The user is looking at tab "${tab.id}" (${tab.title || 'untitled'}, ${tab.url}) and asked you to do something there.`,
    'Work with the solamar tools: start with page_snapshot on that tab, then click, type, press, scroll and wait_for as needed. Stay on that tab unless the task needs another page; open new tabs only when the task asks for it.',
    UNTRUSTED_RULE,
    'Payments always wait for the user to approve them in Solamar. If a tool says it is waiting, tell the user in one line and stop; they can run you again after approving.',
    'Never type passwords, card numbers or one-time codes, and never read them out.',
    'The user may follow up on earlier requests in this conversation ("join these", "open the second one"): use what you found and said before instead of asking again, and look at the page again before acting.',
    'Write a short progress line for the user before each group of actions, in the language the user wrote the task in. Finish with one or two sentences: what you did and anything left for them to do.'
  ].join('\n\n')
}

type ToolContent = { type: string; text?: string; data?: string; mimeType?: string }

function toApiContent(content: ToolContent[]): Anthropic.Beta.BetaToolResultBlockParam['content'] {
  return content.map((c) =>
    c.type === 'image' && c.data && c.mimeType
      ? { type: 'image' as const, source: { type: 'base64' as const, media_type: c.mimeType as 'image/png', data: c.data } }
      : { type: 'text' as const, text: c.type === 'text' ? (c.text ?? '') : JSON.stringify(c) }
  )
}

/** API key engine: a manual tool loop over Solamar's MCP tools, connected in-process (no port, no secret). */
export async function runAgentWithApi(opts: {
  client: Anthropic
  model: string
  server: McpServer
  system: string
  task: string
  history: AgentTurn[]
  signal: AbortSignal
  onText: (t: string) => void
}): Promise<void> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: 'solamar-page-agent', version: '0.1.0' })
  await opts.server.connect(serverSide)
  await mcp.connect(clientSide)
  try {
    const { tools } = await mcp.listTools()
    const apiTools = tools.map((t) => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema }))
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...opts.history.flatMap((h): Anthropic.Beta.BetaMessageParam[] => [
        { role: 'user', content: asked(h) },
        { role: 'assistant', content: clip(h.answer, 3000) }
      ]),
      { role: 'user', content: opts.task }
    ]
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (opts.signal.aborted) return
      const stream = opts.client.beta.messages.stream(
        { model: opts.model, max_tokens: 8000, system: opts.system, tools: apiTools, messages, output_config: { effort: 'medium' } },
        { signal: opts.signal }
      )
      stream.on('text', (t) => opts.onText(t))
      const msg = await stream.finalMessage()
      if (msg.stop_reason === 'refusal') throw new RefusalError('Claude declined this task.')
      messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] })
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      if (msg.stop_reason !== 'tool_use' || !uses.length) return
      opts.onText('\n')
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const u of uses) {
        if (opts.signal.aborted) return
        const r = (await mcp.callTool({ name: u.name, arguments: (u.input ?? {}) as Record<string, unknown> }).catch((e: Error) => ({ content: [{ type: 'text', text: e.message }], isError: true }))) as {
          content: ToolContent[]
          isError?: boolean
        }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: toApiContent(r.content ?? []), is_error: !!r.isError })
      }
      messages.push({ role: 'user', content: results })
    }
    opts.onText('\n(Stopped after ' + MAX_TURNS + ' steps.)')
  } finally {
    await mcp.close().catch(() => {})
    await opts.server.close().catch(() => {})
  }
}

/** Claude Code engine: `claude -p` with only Solamar's MCP server (no built-in tools, no user settings). */
export async function runAgentWithClaudeCode(opts: {
  url: string
  secret: string
  model?: string
  system: string
  task: string
  history: AgentTurn[]
  signal: AbortSignal
  onText: (t: string) => void
}): Promise<void> {
  const dir = join(tmpdir(), 'solamar-claude-code')
  mkdirSync(dir, { recursive: true })
  // The bearer secret goes in a file only this user can read, removed when the run ends (not on the command line).
  const config = join(dir, `mcp-${randomBytes(6).toString('hex')}.json`)
  writeFileSync(config, JSON.stringify({ mcpServers: { solamar: { type: 'http', url: opts.url, headers: { Authorization: `Bearer ${opts.secret}` } } } }), { mode: 0o600 })
  try {
    for await (const t of claudeCodeStream(opts.system, promptWithHistory(opts.task, opts.history), { signal: opts.signal, model: opts.model, mcpConfig: config, allowedTools: ['mcp__solamar'] })) opts.onText(t)
  } finally {
    try {
      unlinkSync(config)
    } catch {}
  }
}
