// Boost editor (in the frame, right of the page): colours, font, zapped elements and own CSS/JS for one site.
import { useEffect, useRef, useState } from 'react'
import { MousePointerClick, RotateCw, Trash2, X, Zap } from 'lucide-react'
import { BOOST_FONTS } from '@shared/defaults'
import type { AppState, Boost, BoostFilter } from '@shared/types'
import { boostMatches, siteOf } from '@shared/util'
import { call } from './api'

const FILTERS: [BoostFilter, string][] = [
  ['none', 'Original'],
  ['dark', 'Dark'],
  ['sepia', 'Warm'],
  ['gray', 'Gray']
]

/** Text that is sent while typing, a moment after the last key, so live CSS does not reflow on every key. */
function useDebounced(value: string, send: (v: string) => void, ms = 250) {
  const [text, setText] = useState(value)
  const timer = useRef(0)
  const latest = useRef(send)
  latest.current = send
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const change = (v: string) => {
    setText(v)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => latest.current(v), ms)
  }
  return [text, change] as const
}

export function BoostPanel({ s }: { s: AppState }) {
  const ed = s.boostEditor
  const b = s.boosts.find((x) => x.id === ed?.id)
  if (!ed || !b) return null
  return <Editor key={b.id} s={s} b={b} zapping={ed.zapping} />
}

function Editor({ s, b, zapping }: { s: AppState; b: Boost; zapping: boolean }) {
  const set = (patch: Partial<Boost>) => call('updateBoost', b.id, patch)
  const [css, setCss] = useDebounced(b.css, (v) => set({ css: v }))
  const [js, setJs] = useDebounced(b.js, (v) => set({ js: v }))
  const [jsDirty, setJsDirty] = useState(false)
  const active = s.items.find((i) => i.id === s.activeId)
  const onSite = /^https?:/.test(active?.url ?? '') && boostMatches(b.domain, siteOf(active?.url))

  return (
    <aside className="ai-panel boost-panel" aria-label={`Boost for ${b.domain}`}>
      <header className="ai-head">
        <Zap size={16} aria-hidden />
        <strong>Boost</strong>
        <span className="fine ellipsis" title={`Applies to ${b.domain} and its subdomains`}>
          {b.domain}
        </span>
        <span className="grow" />
        <label className="toggle" title={b.enabled ? 'Turn this boost off' : 'Turn this boost on'}>
          <input type="checkbox" checked={b.enabled} onChange={(e) => set({ enabled: e.target.checked })} aria-label="Boost on" />
          <span aria-hidden />
        </label>
        <button className="icon-btn" aria-label="Close boost editor" onClick={() => call('closeBoost')}>
          <X size={16} />
        </button>
      </header>

      <div className="boost-body">
        <section className="boost-sec">
          <h3>Colours</h3>
          <div className="segmented" role="radiogroup" aria-label="Page colours">
            {FILTERS.map(([v, l]) => (
              <button key={v} role="radio" aria-checked={b.filter === v} className={b.filter === v ? 'on' : ''} onClick={() => set({ filter: v })}>
                {l}
              </button>
            ))}
          </div>
          <label className="field hue-field">
            <span>
              Tint {b.hue ? `${b.hue}°` : ''}
              {b.hue > 0 && (
                <button className="btn link small" onClick={() => set({ hue: 0 })}>
                  Reset
                </button>
              )}
            </span>
            <input className="hue-range" type="range" min={0} max={359} step={1} value={b.hue} onChange={(e) => set({ hue: Number(e.target.value) })} aria-label="Tint" />
          </label>
        </section>

        <section className="boost-sec">
          <h3>Font</h3>
          <div className="font-grid" role="radiogroup" aria-label="Page font">
            {BOOST_FONTS.map((f) => (
              <button
                key={f.id}
                role="radio"
                aria-checked={b.font === f.id}
                className={'font-chip' + (b.font === f.id ? ' on' : '')}
                style={f.stack ? { fontFamily: f.stack } : undefined}
                onClick={() => set({ font: f.id })}
              >
                <span className="font-sample" aria-hidden>
                  Aa
                </span>
                {f.label}
              </button>
            ))}
          </div>
        </section>

        <section className="boost-sec">
          <h3>Zap</h3>
          <p className="fine">Click things on the page to hide them on this site for good: banners, sidebars, popups. Scroll while pointing to pick a bigger or smaller area.</p>
          {zapping ? (
            <button className="btn primary zap-on" onClick={() => call('stopZap')}>
              <MousePointerClick size={15} aria-hidden /> Click on the page… Done
            </button>
          ) : (
            <button className="btn" disabled={!onSite} title={onSite ? '' : `Open ${b.domain} to zap things on it`} onClick={() => call('startZap')}>
              <MousePointerClick size={15} aria-hidden /> Zap something
            </button>
          )}
          {b.zaps.length > 0 && (
            <ul className="zap-list">
              {b.zaps.map((z) => (
                <li key={z}>
                  <code className="ellipsis" title={z}>
                    {z}
                  </code>
                  <button className="icon-btn" aria-label={`Show ${z} again`} title="Show again" onClick={() => set({ zaps: b.zaps.filter((x) => x !== z) })}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="boost-sec">
          <h3>CSS</h3>
          <textarea
            className="input code"
            spellCheck={false}
            rows={6}
            placeholder={'body {\n  max-width: 900px;\n  margin: auto;\n}'}
            value={css}
            onChange={(e) => setCss(e.target.value)}
            aria-label="Custom CSS"
          />
          <h3>JavaScript</h3>
          <textarea
            className="input code"
            spellCheck={false}
            rows={5}
            placeholder="document.title = 'Focus'"
            value={js}
            onChange={(e) => {
              setJs(e.target.value)
              setJsDirty(true)
            }}
            aria-label="Custom JavaScript"
          />
          <div className="boost-js-foot">
            <span className="fine">Runs on this site each time a page loads.</span>
            {jsDirty && onSite && (
              <button
                className="btn small"
                onClick={() => {
                  setJsDirty(false)
                  call('reloadActive')
                }}
              >
                <RotateCw size={13} aria-hidden /> Reload to run
              </button>
            )}
          </div>
        </section>
      </div>

      <footer className="boost-foot">
        <button className="btn ghost danger" onClick={() => call('deleteBoost', b.id)}>
          <Trash2 size={14} aria-hidden /> Delete boost
        </button>
      </footer>
    </aside>
  )
}
