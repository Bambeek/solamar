// Write with AI dialog and the command bar's AI answer panel.
import { Fragment, useEffect, useRef, useState } from 'react'
import { Check, Copy, Globe, Languages, MessageSquareReply, Minimize2, PenLine, Smile, Sparkles, SpellCheck, Wand2, Briefcase } from 'lucide-react'
import type { AppState } from '@shared/types'
import { hostOf } from '@shared/util'
import { call } from './api'
import { composing, IS_MAC, keyLabel } from './keys'

const ACTIONS: { id: string; label: string; Icon: typeof Sparkles }[] = [
  { id: 'fix', label: 'Fix mistakes', Icon: SpellCheck },
  { id: 'clearer', label: 'Clearer', Icon: Wand2 },
  { id: 'shorter', label: 'Shorter', Icon: Minimize2 },
  { id: 'formal', label: 'More formal', Icon: Briefcase },
  { id: 'friendly', label: 'Friendlier', Icon: Smile },
  { id: 'english', label: 'English', Icon: Languages },
  { id: 'polish', label: 'Polski', Icon: Languages }
]

export function engineName(s: AppState, feature: 'write' | 'search'): string {
  const ai = s.settings.ai
  const e = ai.features[feature] ?? ai.engine
  return e === 'claude-code' ? 'Claude Code · your plan' : e === 'anthropic' ? 'Claude API' : 'local model'
}

export function WriteView({ s }: { s: AppState }) {
  const w = s.write
  const [instruction, setInstruction] = useState('')
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // Every new result replaces the draft; edits only happen once it is finished, so nothing of the user's is lost.
    setDraft(w?.result ?? '')
  }, [w?.result, w?.busy])
  useEffect(() => input.current?.focus(), [])
  if (!w) return null
  const empty = !w.original.trim()
  const blocked = !!w.error && !w.field && !w.original
  const run = (action: string) => call('aiWriteRun', action, action === 'custom' ? instruction : '')
  const apply = () => draft.trim() && call('aiWriteApply', draft)

  return (
    <div className="dialog card write" role="dialog" aria-label="Write with AI">
      <h2>
        <PenLine size={18} aria-hidden /> Write with AI
        <span className="fine write-where ellipsis">
          {w.field ? `${w.field} · ` : ''}
          {w.site}
        </span>
      </h2>
      {blocked ? (
        <p className="warn">{w.error}</p>
      ) : (
        <>
          {!empty && (
            <details className="write-original" open={w.original.length < 400}>
              <summary>{w.scope === 'selection' ? 'Selected text' : 'Text in the field'}</summary>
              <p>{w.original}</p>
            </details>
          )}
          <div className="write-actions">
            <button className="chip reply-chip" disabled={w.busy} onClick={() => run('reply')} title={empty ? 'Read the conversation on the page and draft a reply' : 'Draft a reply that says what you wrote, from the conversation on the page'}>
              <MessageSquareReply size={13} aria-hidden /> Draft a reply
            </button>
            {!empty &&
              ACTIONS.map(({ id, label, Icon }) => (
                <button key={id} className="chip" disabled={w.busy} onClick={() => run(id)}>
                  <Icon size={13} aria-hidden /> {label}
                </button>
              ))}
          </div>
          <form
            className="write-ask"
            onSubmit={(e) => {
              e.preventDefault()
              if (instruction.trim()) run('custom')
            }}
          >
            <Sparkles size={15} aria-hidden />
            <input
              ref={input}
              className="input"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={empty ? 'What should I write? e.g. a polite reply saying I can come on Friday' : 'Or tell AI what to change…'}
              aria-label="Instruction for AI"
            />
          </form>
          {(w.busy || w.result || w.error) && (
            <div className="write-result">
              <textarea
                className="input"
                value={w.busy ? w.result : draft}
                readOnly={w.busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !composing(e) && (IS_MAC ? e.metaKey : e.ctrlKey) && (e.preventDefault(), apply())}
                aria-label="Suggested text"
                placeholder={w.busy ? 'Writing…' : ''}
              />
              {w.error && <p className="warn">{w.error}</p>}
            </div>
          )}
        </>
      )}
      <div className="dialog-foot">
        <span className="fine grow">via {engineName(s, 'write')}</span>
        {draft && !w.busy && (
          <button
            className="btn ghost"
            onClick={() => {
              call('copyText', draft)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} Copy
          </button>
        )}
        <button className="btn" onClick={() => call('closeOverlay')}>
          Close
        </button>
        {!blocked && (
          <button className="btn primary" disabled={w.busy || !draft.trim()} onClick={apply} title={keyLabel('Ctrl+Enter')}>
            {w.scope === 'selection' ? 'Replace selection' : empty ? 'Insert' : 'Replace text'}
          </button>
        )}
      </div>
    </div>
  )
}

/** Text with [title](url) and bare links turned into buttons that open a tab. */
export function Linked({ text }: { text: string }) {
  const parts: (string | { label: string; url: string })[] = []
  const rx = /\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>\]]+)/g
  let last = 0
  for (const m of text.matchAll(rx)) {
    if (m.index! > last) parts.push(text.slice(last, m.index))
    if (m[2]) {
      parts.push({ label: m[1], url: m[2] })
      last = m.index! + m[0].length
    } else {
      const url = m[3].replace(/[.,;:!?'"]+$/, '') // leave sentence punctuation in the text
      parts.push({ label: hostOf(url), url })
      last = m.index! + url.length
    }
  }
  parts.push(text.slice(last))
  const open = (url: string) => call('openTab', url).then(() => call('closeOverlay'))
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p.replace(/\*\*(.+?)\*\*/g, '$1')}</Fragment>
        ) : (
          <button key={i} className="inline-link" title={p.url} onMouseDown={(e) => (e.preventDefault(), open(p.url))}>
            {p.label}
          </button>
        )
      )}
    </>
  )
}

export function AnswerPanel({ s }: { s: AppState }) {
  const a = s.answer
  if (!a) return null
  const open = (url: string) => call('openTab', url).then(() => call('closeOverlay'))
  return (
    <div className="answer" aria-live="polite">
      <div className="answer-text">{a.text ? <Linked text={a.text} /> : a.busy ? <span className="typing">{a.web ? 'Searching the web…' : 'Thinking…'}</span> : null}</div>
      {a.error && <p className="warn">{a.error}</p>}
      {a.sources.length > 0 && (
        <ul className="answer-sources">
          {a.sources.slice(0, 6).map((src) => (
            <li key={src.url}>
              <button className="source" onMouseDown={(e) => (e.preventDefault(), open(src.url))} title={src.url}>
                <Globe size={12} aria-hidden />
                <span className="ellipsis">{src.title || hostOf(src.url)}</span>
                <span className="fine nowrap">{hostOf(src.url)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="answer-foot fine">
        <Sparkles size={12} aria-hidden /> {engineName(s, 'search')}
        {a.web ? ' · searched the web' : ' · from model memory, may be out of date'}
      </div>
    </div>
  )
}
