// Talks to the user's own Claude Code CLI: status, registering Solamar's MCP server, and (personal builds only)
// running Solamar's AI features through it on the user's Claude plan.
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeCliState } from '@shared/types'

const TIMEOUT = 25_000

function run(args: string[]): Promise<{ code: number; out: string }> {
  // `claude` is claude.exe for the native install, claude.cmd for an npm install (which needs a shell).
  const attempt = (cmd: string, shell: boolean) =>
    new Promise<{ code: number; out: string }>((resolve, reject) => {
      execFile(cmd, args, { timeout: TIMEOUT, windowsHide: true, shell, env: process.env }, (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return reject(err)
        resolve({ code: err ? ((err as any).code ?? 1) : 0, out: `${stdout}${stderr}` })
      })
    })
  return attempt('claude', false).catch(() => (process.platform === 'win32' ? attempt('claude.cmd', true) : Promise.reject(new Error('not found'))))
}

export async function claudeCliStatus(url: string, secret: string): Promise<ClaudeCliState> {
  const state: ClaudeCliState = { checked: true, installed: false, registered: 'unknown', loggedIn: null }
  try {
    const v = await run(['--version'])
    if (v.code !== 0) return state
    state.installed = true
    state.version = /(\d+\.\d+\.\d+)/.exec(v.out)?.[1]
  } catch {
    return state
  }
  try {
    const a = await run(['auth', 'status', '--json'])
    const j = JSON.parse(a.out.slice(a.out.indexOf('{')))
    state.loggedIn = !!j.loggedIn
    state.plan = typeof j.subscriptionType === 'string' ? j.subscriptionType : undefined
  } catch {
    state.loggedIn = null
  }
  try {
    const g = await run(['mcp', 'get', 'solamar'])
    // Added under the working name: works, but Connect replaces it with the current entry.
    if (g.code !== 0 || !/URL:/.test(g.out)) state.registered = /URL:/.test((await run(['mcp', 'get', 'harbor'])).out) ? 'stale' : 'no'
    else {
      const sameUrl = g.out.includes(`URL: ${url}`)
      const sameSecret = g.out.includes(`Bearer ${secret}`)
      state.registered = sameUrl && sameSecret ? 'yes' : 'stale'
    }
  } catch {
    state.registered = 'unknown'
  }
  return state
}

/** Registers Solamar in the user's Claude Code (user scope), replacing an older entry. */
export async function claudeCliConnect(url: string, secret: string): Promise<{ ok: boolean; error?: string }> {
  await run(['mcp', 'remove', 'solamar', '-s', 'user']).catch(() => {})
  await run(['mcp', 'remove', 'harbor', '-s', 'user']).catch(() => {}) // the working name's entry
  try {
    const r = await run(['mcp', 'add', '--transport', 'http', '--scope', 'user', 'solamar', url, '--header', `Authorization: Bearer ${secret}`])
    return r.code === 0 ? { ok: true } : { ok: false, error: r.out.trim().split('\n').pop() || 'claude mcp add failed' }
  } catch {
    return { ok: false, error: 'Claude Code is not installed (the `claude` command was not found).' }
  }
}

/** Opens a terminal window running Claude Code's own login. The user signs in there; Solamar sees nothing of it. */
export function claudeCliLogin(): void {
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '"Claude Code login"', 'cmd', '/k', 'claude auth login'], { detached: true, windowsHide: false, stdio: 'ignore' }).unref()
  else if (process.platform === 'darwin') spawn('osascript', ['-e', 'tell application "Terminal" to do script "claude auth login"'], { detached: true, stdio: 'ignore' }).unref()
  else spawn('x-terminal-emulator', ['-e', 'claude auth login'], { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Streams a reply from the user's own Claude Code CLI (their Claude plan), with no tools, no MCP servers and no
 * settings loaded. Personal builds only: Anthropic does not allow third-party products to offer Claude plan usage,
 * so public builds hide this engine (see claudeCodeEngineAllowed in engines.ts).
 */
export async function* claudeCodeStream(
  system: string,
  prompt: string,
  opts: { signal: AbortSignal; model?: string; tools?: string[]; mcpConfig?: string; allowedTools?: string[] }
): AsyncGenerator<string> {
  const dir = join(tmpdir(), 'solamar-claude-code')
  mkdirSync(dir, { recursive: true })
  const sysFile = join(dir, `system-${randomBytes(6).toString('hex')}.txt`)
  writeFileSync(sysFile, system || 'You are a helpful assistant inside the Solamar browser.')
  const tools = opts.tools ?? []
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', tools.join(','), '--strict-mcp-config', '--no-session-persistence', '--setting-sources', '', '--disable-slash-commands', '--system-prompt-file', sysFile]
  if (opts.mcpConfig) args.push('--mcp-config', opts.mcpConfig) // with --strict-mcp-config: only this server
  const allowed = [...tools, ...(opts.allowedTools ?? [])]
  if (allowed.length) args.push('--allowedTools', ...allowed)
  if (opts.model) args.push('--model', opts.model)
  const child = spawn('claude', args, { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
  const kill = () => child.kill()
  opts.signal.addEventListener('abort', kill, { once: true })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  const spawned = new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', (err) => reject((err as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('Claude Code is not installed (the `claude` command was not found).') : err))
  })
  try {
    await spawned
    child.stdin.end(prompt)
    let buf = ''
    let result: { is_error?: boolean; result?: string } | null = null
    let wrote = false
    for await (const chunk of child.stdout) {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let ev: any
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
          wrote = true
          yield ev.event.delta.text
        } else if (ev.type === 'stream_event' && ev.event?.type === 'message_start' && wrote) yield '\n' // next turn after tool calls
        else if (ev.type === 'result') result = ev
      }
    }
    if (opts.signal.aborted) return
    if (!result) throw new Error(stderr.trim().split('\n').pop() || 'Claude Code stopped without an answer.')
    if (result.is_error) {
      const msg = String(result.result ?? 'Claude Code error')
      throw new Error(/log ?in|oauth|expired/i.test(msg) ? 'Claude Code is signed out. Settings > Claude Code > Sign in again.' : msg)
    }
  } finally {
    opts.signal.removeEventListener('abort', kill)
    if (child.exitCode === null) child.kill()
    try {
      unlinkSync(sysFile)
    } catch {}
  }
}

export async function claudeCliVersion(): Promise<string | null> {
  try {
    const v = await run(['--version'])
    return v.code === 0 ? (/(\d+\.\d+\.\d+)/.exec(v.out)?.[1] ?? 'unknown') : null
  } catch {
    return null
  }
}
