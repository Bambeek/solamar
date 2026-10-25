// Settings and prompts for AI engines and for Claude Code driving Solamar.
import { useEffect, useState } from 'react'
import { Check, CircleAlert, CircleCheck, CircleDashed, Copy, KeyRound, Link2, LogIn, Pause, Play, RefreshCw, ShieldAlert, ShieldCheck, SquareTerminal, X } from 'lucide-react'
import { AI_FEATURES, ANTHROPIC_MODELS } from '@shared/defaults'
import type { AppState, EngineId } from '@shared/types'
import { call } from './api'

const ALL_ENGINES: [EngineId, string][] = [
  ['claude-code', 'Claude Code (your Claude plan)'],
  ['ollama', 'Local model (Ollama)'],
  ['anthropic', 'Claude (your API key)']
]

export function AiSettings({ s }: { s: AppState }) {
  const st = s.settings.ai
  const ENGINES = ALL_ENGINES.filter(([id]) => id !== 'claude-code' || s.ai.claudeCodeAllowed)
  const upd = (ai: object) => call('updateSettings', { ai })
  const [key, setKey] = useState('')
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const saveKey = async (value: string | null) => {
    setBusy(true)
    const r = await call<{ ok: boolean; error?: string }>('setAnthropicKey', value)
    setBusy(false)
    setKey('')
    setKeyMsg(r.ok ? { ok: true, text: value ? 'Key checked and saved in the Windows keychain.' : 'Key removed.' } : { ok: false, text: r.error ?? 'Could not save the key.' })
  }

  return (
    <>
      <label className="check">
        <input type="checkbox" checked={st.enabled} onChange={(e) => upd({ enabled: e.target.checked })} /> Use AI features (summaries, questions, tidy tabs, writing, search)
      </label>
      <p className="fine">
        Pick what runs each feature. {s.ai.claudeCodeAllowed && 'Claude Code uses your Claude subscription through the Claude Code app on this PC (personal builds only). '}
        A local model never leaves this PC. The API option is billed to your Anthropic API account.
      </p>

      {st.enabled && (
        <>
          <p className={s.ai.available ? 'ok' : 'warn'}>{s.ai.available === null ? 'Checking…' : s.ai.available ? 'Ready.' : s.ai.error}</p>
          <label className="field">
            <span>Default engine</span>
            <select className="select" value={st.engine} onChange={(e) => upd({ engine: e.target.value })}>
              {ENGINES.map(([id, l]) => (
                <option key={id} value={id}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Per feature</span>
            <ul className="feature-engines">
              {AI_FEATURES.map((f) => (
                <li key={f.id}>
                  <span>{f.label}</span>
                  <select className="select small" value={st.features[f.id] ?? ''} onChange={(e) => upd({ features: { [f.id]: e.target.value || null } })} aria-label={`Engine for ${f.label}`}>
                    <option value="">Default</option>
                    {ENGINES.map(([id, l]) => (
                      <option key={id} value={id}>
                        {l}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>

          {s.ai.claudeCodeAllowed && (
            <>
              <h3 className="settings-h">Claude Code (your plan)</h3>
              <label className="field">
                <span>Model</span>
                <select className="select" value={st.claudeCodeModel} onChange={(e) => upd({ claudeCodeModel: e.target.value })}>
                  <option value="">Claude Code default</option>
                  <option value="opus">Opus</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku (fastest)</option>
                </select>
              </label>
              <small className="fine">Runs your own signed-in Claude Code with no tools. Each request takes a few seconds to start. Counts toward your plan's usage.</small>
            </>
          )}

          <h3 className="settings-h">Local model</h3>
          {s.ai.models.length > 0 ? (
            <label className="field">
              <span>Ollama model</span>
              <select className="select" value={st.model} onChange={(e) => upd({ model: e.target.value })}>
                {s.ai.models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="fine">Ollama is not running here or has no models. Install it from ollama.com, then run <code>ollama pull llama3.2</code>.</p>
          )}
          <label className="field">
            <span>Ollama address (this computer only)</span>
            <input className="input" defaultValue={st.host} onBlur={(e) => upd({ host: e.target.value })} />
          </label>

          <h3 className="settings-h">Claude (Anthropic API)</h3>
          <label className="field">
            <span>Model</span>
            <select className="select" value={st.anthropicModel} onChange={(e) => upd({ anthropicModel: e.target.value })}>
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>API key {s.ai.hasKey && <span className="ok"> · saved</span>}</span>
            {!s.ai.keyStorage ? (
              <p className="warn">This computer has no usable keychain, so Solamar will not store a key.</p>
            ) : (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (key.trim()) saveKey(key.trim())
                }}
              >
                <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder={s.ai.hasKey ? 'Replace key' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Anthropic API key" />
                <button className="btn" disabled={busy || !key.trim()}>
                  <KeyRound size={14} /> {busy ? 'Checking…' : 'Save'}
                </button>
                {s.ai.hasKey && (
                  <button type="button" className="btn ghost" onClick={() => saveKey(null)}>
                    Remove
                  </button>
                )}
              </form>
            )}
            {keyMsg && <p className={keyMsg.ok ? 'ok' : 'warn'}>{keyMsg.text}</p>}
            <small className="fine">Get a key at console.anthropic.com. It is encrypted with the Windows keychain and never shown again. Claude subscription (Pro/Max) logins cannot be used here; connect Claude Code instead.</small>
          </div>
        </>
      )}
    </>
  )
}

export function ClaudeCodeSettings({ s }: { s: AppState }) {
  const st = s.settings.agent
  const ag = s.agent
  const [copied, setCopied] = useState(false)
  const upd = (agent: object) => call('updateSettings', { agent })
  const grants = Object.entries(st.grants).sort(([a], [b]) => a.localeCompare(b))
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={st.mcpEnabled} onChange={(e) => upd({ mcpEnabled: e.target.checked })} /> Let Claude Code use Solamar
      </label>
      <p className="fine">
        Your own Claude Code (on your Claude plan) connects to Solamar on this computer and can open tabs, read pages, click and type. It works in its own <strong>Claude</strong> space and in
        tabs you share with it.
      </p>
      {st.mcpEnabled && (
        <>
          <p className={ag.serving ? 'ok' : 'warn'}>
            {ag.serving ? `Listening on 127.0.0.1:${st.port}` : `Could not listen on port ${st.port}. Another app may use it.`}
            {ag.paused && ' · paused'}
            {ag.lastCall > 0 && ` · last used ${new Date(ag.lastCall).toLocaleTimeString()}`}
          </p>
          <CliStatus s={s} />
          <div className="field">
            <span>How much it does on its own</span>
            <div className="segmented" role="radiogroup" aria-label="Approvals">
              {(
                [
                  ['auto', 'Works on its own'],
                  ['ask', 'Ask before send, submit, delete']
                ] as const
              ).map(([v, l]) => (
                <button key={v} role="radio" aria-checked={st.approvals === v} className={st.approvals === v ? 'on' : ''} onClick={() => upd({ approvals: v })}>
                  {l}
                </button>
              ))}
            </div>
            <small className="fine">
              Either way Solamar asks before payments and purchases, and AI never types passwords, card numbers or one-time codes. Pages can contain instructions aimed at AI; on its own
              Claude Code may follow them, so keep it to tasks you would let it finish.
            </small>
          </div>
          <div className="field">
            <span>Which sites</span>
            <div className="segmented" role="radiogroup" aria-label="Which sites Claude Code may use">
              {(
                [
                  ['all', 'All sites'],
                  ['ask', 'Ask for each new site']
                ] as const
              ).map(([v, l]) => (
                <button key={v} role="radio" aria-checked={st.siteAccess === v} className={st.siteAccess === v ? 'on' : ''} onClick={() => upd({ siteAccess: v })}>
                  {l}
                </button>
              ))}
            </div>
            <small className="fine">Blocked sites below are always off limits.</small>
          </div>
          <details className="manual">
            <summary>Manual setup</summary>
          <div className="field">
            <span>Run this once in a terminal</span>
            <div className="command-copy">
              <code>{ag.command.replace(/Bearer \S+"/, 'Bearer ••••••"')}</code>
              <button
                className="btn"
                onClick={() => {
                  call('copyText', ag.command)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <small className="fine">The command contains a secret for this PC only. Then check with /mcp inside Claude Code.</small>
          </div>
          </details>
          <label className="check">
            <input type="checkbox" checked={st.allTabs} onChange={(e) => upd({ allTabs: e.target.checked })} /> Let it see all my tabs (otherwise: Claude space and shared tabs only)
          </label>
          <div className="row-btns">
            {ag.paused ? (
              <button className="btn" onClick={() => call('agentPause', false)}>
                <Play size={14} /> Resume
              </button>
            ) : (
              <button className="btn" onClick={() => call('agentPause', true)}>
                <Pause size={14} /> Stop Claude Code now
              </button>
            )}
          </div>
          <div className="field">
            <span>Sites</span>
            <ul className="allow-list">
              {grants.length === 0 && <li className="fine">No answers yet. Solamar asks the first time Claude Code wants a site.</li>}
              {grants.map(([site, g]) => (
                <li key={site}>
                  {g === 'allow' ? <ShieldCheck size={14} className="ok" aria-label="Allowed" /> : <ShieldAlert size={14} className="warn" aria-label="Blocked" />}
                  <span>{site}</span>
                  <button className="btn link small" onClick={() => upd({ grants: { [site]: null } })}>
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {ag.log.length > 0 && (
            <div className="field">
              <span>Recent actions</span>
              <ul className="agent-log">
                {[...ag.log].reverse().slice(0, 12).map((l, i) => (
                  <li key={i} className={l.outcome}>
                    <span className="nowrap">{new Date(l.at).toLocaleTimeString()}</span>
                    <span>
                      {l.tool} {l.target && <code>{l.target.slice(0, 60)}</code>}
                    </span>
                    <span className="nowrap">{l.outcome}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  )
}

function CliStatus({ s }: { s: AppState }) {
  const cli = s.agent.cli
  useEffect(() => {
    if (!cli.checked && !cli.busy) call('claudeCliCheck')
  }, [])
  const row = (ok: boolean | null, text: string) => (
    <li className={ok === null ? 'fine' : ok ? 'ok' : 'warn'}>
      {ok === null ? <CircleDashed size={14} aria-hidden /> : ok ? <CircleCheck size={14} aria-hidden /> : <CircleAlert size={14} aria-hidden />}
      <span>{text}</span>
    </li>
  )
  const plan = cli.plan ? ` (Claude ${cli.plan[0].toUpperCase()}${cli.plan.slice(1)})` : ''
  return (
    <div className="field">
      <span>Claude Code on this PC</span>
      {!cli.checked ? (
        <p className="fine">Checking…</p>
      ) : (
        <ul className="cli-status">
          {row(cli.installed, cli.installed ? `Installed${cli.version ? ` · ${cli.version}` : ''}` : 'Not found. Install Claude Code first.')}
          {cli.installed &&
            row(
              cli.registered === 'yes' ? true : cli.registered === 'unknown' ? null : false,
              cli.registered === 'yes' ? 'Solamar is added' : cli.registered === 'stale' ? 'Added with an old address or secret' : cli.registered === 'no' ? 'Solamar is not added yet' : 'Could not check'
            )}
          {cli.installed && row(cli.loggedIn, cli.loggedIn ? `Signed in${plan}` : cli.loggedIn === false ? 'Signed out' : 'Sign-in unknown')}
        </ul>
      )}
      {cli.message && <p className="fine">{cli.message}</p>}
      <div className="row-btns">
        {cli.installed && cli.registered !== 'yes' && (
          <button className="btn primary" disabled={cli.busy} onClick={() => call('claudeCliConnect')}>
            <Link2 size={14} /> {cli.busy ? 'Working…' : 'Connect automatically'}
          </button>
        )}
        {cli.installed && (
          <button className="btn" onClick={() => call('claudeCliLogin')} title="Opens Claude Code's own sign-in in a terminal window">
            <LogIn size={14} /> {cli.loggedIn ? 'Sign in again' : 'Sign in to Claude Code'}
          </button>
        )}
        <button className="btn ghost" disabled={cli.busy} onClick={() => call('claudeCliCheck')}>
          <RefreshCw size={14} /> Check again
        </button>
      </div>
      <small className="fine">"Signed in" can show while an old session has expired. If Claude Code says "OAuth session expired", use Sign in again.</small>
    </div>
  )
}

/** Solamar's own approval card. Lives in the overlay view, which no agent tool can reach. */
export function ConfirmCard({ s }: { s: AppState }) {
  const c = s.confirm
  if (!c) return null
  const decide = (answer: string) => call('agentDecide', c.id, answer)
  return (
    <div className="dialog card confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-detail">
      <div className="confirm-head">
        <span className="confirm-icon">
          <SquareTerminal size={18} />
        </span>
        <h2 id="confirm-title">{c.title}</h2>
      </div>
      <p id="confirm-detail">{c.detail}</p>
      <div className="dialog-foot">
        {c.kind === 'site' ? (
          <>
            <button className="btn ghost" onClick={() => decide('block')}>
              <X size={14} /> Block site
            </button>
            <span className="grow" />
            <button className="btn" onClick={() => decide('always')}>
              Always allow this site
            </button>
            <button className="btn primary" onClick={() => decide('all')} autoFocus>
              Allow all sites
            </button>
          </>
        ) : (
          <>
            <span className="fine grow">Esc declines</span>
            <button className="btn" onClick={() => decide('deny')} autoFocus>
              Decline
            </button>
            <button className="btn primary" onClick={() => decide('allow')}>
              Allow
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function DrivingPill({ s }: { s: AppState }) {
  const ag = s.agent
  if (!s.settings.agent.mcpEnabled || (!ag.active && !ag.paused)) return null
  const last = ag.log[ag.log.length - 1]
  // The same tools serve Claude Code and Solamar's own page agent; steps since the agent's run started are its own.
  const who = s.pageAgent && last && last.at >= s.pageAgent.since ? 'Agent' : 'Claude Code'
  return (
    <div className={'driving' + (ag.paused ? ' paused' : '')} role="status">
      <SquareTerminal size={14} aria-hidden />
      <span className="ellipsis" title={last ? `${last.tool} ${last.target}` : ''}>
        {ag.paused ? `${who} paused` : `${who}${last ? ` · ${last.tool.replace('_', ' ')}` : ''}`}
      </span>
      {ag.spaceId && !ag.paused && who === 'Claude Code' && (
        <button className="btn link small" onClick={() => call('switchSpace', ag.spaceId)}>
          Watch
        </button>
      )}
      <button className="btn link small" onClick={() => call('agentPause', !ag.paused)}>
        {ag.paused ? 'Resume' : 'Stop'}
      </button>
    </div>
  )
}
