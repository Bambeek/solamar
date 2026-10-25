import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, FolderTree, MessageSquarePlus, RefreshCw, Send, Sparkles, Square, X } from 'lucide-react'
import { ANTHROPIC_MODELS } from '@shared/defaults'
import type { AppState, PageAgentTurn } from '@shared/types'
import { call } from './api'
import { Markdown } from './Markdown'
import { Gull, GullHead, type GullMood } from './Gull'
import gullPeek from './assets/settings/gull-peek.webp'
import '../styles/ai-panel.css'

function engineLabel(s: AppState): string {
  const st = s.settings.ai
  if (!st.enabled) return ''
  if (st.engine === 'claude-code') return 'Claude Code · your plan'
  if (st.engine === 'anthropic') return ANTHROPIC_MODELS.find((m) => m.id === st.anthropicModel)?.label ?? st.anthropicModel
  return st.model ? `Local · ${st.model}` : 'Local'
}

const TOOL_LABELS: Record<string, string> = {
  tabs_list: 'Looked at tabs',
  tab_open: 'Opened a tab',
  tab_show: 'Showed a tab',
  tab_close: 'Closed a tab',
  navigate: 'Went to',
  page_snapshot: 'Read the page',
  page_read: 'Read the page',
  click: 'Clicked',
  type: 'Typed',
  press: 'Pressed a key',
  scroll: 'Scrolled',
  wait_for: 'Waited for',
  screenshot: 'Took a screenshot'
}

/** What a step was about, when it means something to a person (a site or a key), not an element ref or tab id. */
function stepTarget(st: { tool: string; target: string }): string {
  if (!st.target || /^(e\d+|i-[a-z0-9]+)$/.test(st.target) || st.tool === 'page_snapshot' || st.tool === 'page_read') return ''
  return st.target.replace(/^https?:\/\//, '').slice(0, 60)
}

function UserMsg({ children }: { children: ReactNode }) {
  return <div className="ai-msg ai-msg-user">{children}</div>
}

/** The gull's side of the conversation: avatar, then the reply (Markdown) or a working indicator. */
function AiMsg({ text, working, label = 'Working' }: { text?: string; working?: boolean; label?: string }) {
  return (
    <div className="ai-msg ai-msg-ai">
      <GullHead className="ai-avatar" working={working} />
      <div className="ai-msg-body">
        {text ? <Markdown text={text} /> : null}
        {working && (
          <span className="ai-working">
            <span className="ai-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {!text && label}
          </span>
        )}
      </div>
    </div>
  )
}

function Empty({ art, title, mood, children }: { art: 'gull' | 'peek'; title: string; mood?: GullMood; children?: ReactNode }) {
  return (
    <div className={'ai-empty ai-empty-' + art}>
      {art === 'gull' ? <Gull mood={mood} /> : <img className="ai-empty-art" src={gullPeek} alt="" />}
      <h3>{title}</h3>
      {children}
    </div>
  )
}

function Composer({ value, onChange, onSubmit, placeholder, label, busy, onStop, disabled }: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
  label: string
  busy: boolean
  onStop: () => void
  disabled?: boolean
}) {
  return (
    <div className="ai-composer-wrap">
      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} disabled={disabled} />
        {busy ? (
          <button type="button" className="ai-send stop" aria-label="Stop" title="Stop" onClick={onStop}>
            <Square size={13} />
          </button>
        ) : (
          <button type="submit" className="ai-send" aria-label="Send" disabled={!value.trim()}>
            <Send size={15} />
          </button>
        )}
      </form>
    </div>
  )
}

/** Keeps the newest message in view while a reply streams in. */
function useStickToEnd(deps: unknown[]) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Braces matter: newer Chromium returns a Promise from scrollIntoView, which React would treat as a cleanup.
    end.current?.scrollIntoView({ block: 'end' })
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return end
}

export function AiPanel({ s }: { s: AppState }) {
  const { ai } = s
  const enabled = s.settings.ai.enabled
  const [mode, setMode] = useState<'ask' | 'do'>(s.pageAgent ? 'do' : 'ask')
  useEffect(() => {
    if (enabled && ai.available === null) call('aiStatus')
  }, [enabled, ai.available])
  const canClear = mode === 'ask' ? ai.messages.length > 0 || !!ai.tidy?.length : !!s.pageAgent && !s.pageAgent.running

  return (
    <aside className="ai-panel" aria-label="AI">
      <header className="ai-header">
        <GullHead className="ai-header-avatar" working={!!s.pageAgent?.running || ai.busy} />
        <div className="ai-header-text">
          <strong>AI</strong>
          <span className="ellipsis">{engineLabel(s)}</span>
        </div>
        {enabled && ai.available !== false && canClear && (
          <button className="ai-icon-btn" aria-label="New conversation" title="New conversation" onClick={() => call(mode === 'ask' ? 'aiClear' : 'agentClear')}>
            <MessageSquarePlus size={16} />
          </button>
        )}
        <button className="ai-icon-btn" aria-label="Close AI panel" title="Close" onClick={() => call('aiPanel', false)}>
          <X size={16} />
        </button>
      </header>

      {!enabled ? (
        <Empty art="gull" title="Ahoy! I can help with this page">
          <p>Summaries, questions about the page, tab tidying and tasks done for you. Run on Claude (your Claude Code plan or an API key) or on a local model, so nothing leaves this PC. Off until you turn it on.</p>
          <div className="ai-empty-actions">
            <button className="btn primary" onClick={() => call('updateSettings', { ai: { enabled: true } })}>
              Turn on AI
            </button>
            <button className="btn link" onClick={() => call('openOverlay', 'settings', { tab: 'ai' })}>
              Choose engines
            </button>
          </div>
        </Empty>
      ) : ai.available === false ? (
        <Empty art="peek" title="I can't reach the AI engine">
          <p className="ai-error">{ai.error}</p>
          <div className="ai-empty-actions">
            <button className="btn" onClick={() => call('aiStatus')}>
              <RefreshCw size={14} /> Check again
            </button>
            <button className="btn link" onClick={() => call('openOverlay', 'settings', { tab: 'ai' })}>
              Open AI settings
            </button>
          </div>
        </Empty>
      ) : (
        <>
          <div className="ai-tabs" role="tablist" aria-label="AI mode">
            <button role="tab" aria-selected={mode === 'ask'} className={mode === 'ask' ? 'on' : ''} onClick={() => setMode('ask')}>
              Ask
            </button>
            <button role="tab" aria-selected={mode === 'do'} className={mode === 'do' ? 'on' : ''} onClick={() => setMode('do')}>
              Do it for me
            </button>
          </div>
          {mode === 'do' ? <PageAgent s={s} /> : <Ask s={s} />}
        </>
      )}
    </aside>
  )
}

function Ask({ s }: { s: AppState }) {
  const { ai } = s
  const [q, setQ] = useState('')
  const end = useStickToEnd([ai.messages, ai.tidy])
  const ask = (text = q) => {
    if (!text.trim() || ai.busy) return
    call('aiAsk', text)
    setQ('')
  }
  const tabTitle = (id: string) => {
    const it = s.items.find((i) => i.id === id)
    return it?.customTitle || it?.title || it?.url || 'Tab'
  }
  const actions = (
    <div className="ai-chips">
      <button className="ai-chip" disabled={ai.busy || !s.activeId} onClick={() => call('aiSummarize')}>
        <Sparkles size={13} /> Summarize page
      </button>
      <button className="ai-chip" disabled={ai.busy} onClick={() => call('aiTidy')}>
        <FolderTree size={13} /> Tidy today's tabs
      </button>
    </div>
  )
  const empty = ai.messages.length === 0 && !ai.tidy?.length
  return (
    <>
      <div className="ai-thread" aria-live="polite">
        {empty ? (
          <Empty art="gull" title="Ask me about this page">
            <p>I read the page you are looking at and answer from it.</p>
            {actions}
          </Empty>
        ) : (
          <>
            {ai.messages.map((m, i) =>
              m.role === 'user' ? (
                <UserMsg key={i}>{m.content}</UserMsg>
              ) : (
                <AiMsg key={i} text={m.content} working={ai.busy && i === ai.messages.length - 1} label="Thinking" />
              )
            )}
            {ai.tidy && ai.tidy.length > 0 && (
              <div className="ai-card ai-tidy">
                {ai.tidy.map((g, i) => (
                  <div key={i} className="ai-tidy-group">
                    <strong>{g.title}</strong>
                    <ul>
                      {g.itemIds.map((id) => (
                        <li key={id} className="ellipsis">
                          {tabTitle(id)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="ai-row">
                  <button className="btn primary" onClick={() => call('applyTidy')}>
                    Make these folders
                  </button>
                  <button className="btn" onClick={() => call('aiClear')}>
                    Discard
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {ai.error && <p className="ai-error">{ai.error}</p>}
        <div ref={end} />
      </div>
      {!empty && actions}
      <Composer value={q} onChange={setQ} onSubmit={() => ask()} placeholder="Ask about this page…" label="Ask about this page" busy={ai.busy} onStop={() => call('aiCancel')} />
    </>
  )
}

/** One request to the page agent: what was asked, the steps it took, and its reply. */
function Turn({ s, turn, running }: { s: AppState; turn: PageAgentTurn; running: boolean }) {
  const steps = s.agent.log.filter((st) => st.at >= turn.since && st.at <= (turn.until ?? Infinity))
  return (
    <div className={'ai-turn' + (running ? ' running' : '')}>
      <UserMsg>{turn.task}</UserMsg>
      {steps.length > 0 && (
        <details className="ai-steps" open={running}>
          <summary>
            <Check size={13} aria-hidden />
            {steps.length === 1 ? '1 step' : `${steps.length} steps`}
          </summary>
          <ol>
            {steps.map((st, i) => (
              <li key={i} className={'ai-step ' + st.outcome} title={st.note ?? ''}>
                <span className="ai-step-dot" aria-hidden />
                <span className="ellipsis">
                  {TOOL_LABELS[st.tool] ?? st.tool} {stepTarget(st) && <span className="ai-muted">{stepTarget(st)}</span>}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {(turn.text || running) && <AiMsg text={turn.text} working={running} />}
      {turn.error && <p className="ai-error">{turn.error}</p>}
    </div>
  )
}

const EXAMPLES = ['Fill in this form with my details', 'Find the cheapest option here and open it', 'Collect every email address on this page']

/** Solamar's own agent: does a task on the tab you are looking at, with the same guardrails as Claude Code. */
function PageAgent({ s }: { s: AppState }) {
  const run = s.pageAgent
  const [task, setTask] = useState('')
  const end = useStickToEnd([run?.text, run?.earlier.length, s.agent.log.length])
  const go = () => {
    if (!task.trim() || run?.running) return
    call('agentRun', task)
    setTask('')
  }
  const active = s.items.find((i) => i.id === s.activeId)
  return (
    <>
      <div className="ai-thread" aria-live="polite">
        {!run ? (
          <Empty art="gull" title="Tell me what to do on this page">
            <p>I click, type and read for you, and you see every step. Payments always wait for your OK, and you can stop me any time.</p>
            <div className="ai-chips column">
              {EXAMPLES.map((e) => (
                <button key={e} className="ai-chip" onClick={() => setTask(e)}>
                  {e}
                </button>
              ))}
            </div>
          </Empty>
        ) : (
          <>
            {run.earlier.map((t, i) => (
              <Turn key={i} s={s} turn={t} running={false} />
            ))}
            <Turn s={s} turn={run} running={run.running} />
          </>
        )}
        <div ref={end} />
      </div>
      <Composer
        value={task}
        onChange={setTask}
        onSubmit={go}
        placeholder={!active?.url ? 'Open a page first' : run ? 'Follow up, or ask something new' : 'What should I do on this page?'}
        label="Task for the page agent"
        busy={!!run?.running}
        onStop={() => call('agentStop')}
        disabled={!!run?.running}
      />
    </>
  )
}
