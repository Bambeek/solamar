// Downloads panel and History view (overlay dialogs).
import { useEffect, useState } from 'react'
import { Download, FolderOpen, History, Pause, Play, RotateCw, Trash2, X } from 'lucide-react'
import type { AppState, DownloadEntry, HistoryEntry } from '@shared/types'
import { hostOf } from '@shared/util'
import { call } from './api'

function size(n: number): string {
  if (!n) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}

export function DownloadsView({ s }: { s: AppState }) {
  const act = (d: DownloadEntry, a: string) => call('downloadAction', d.id, a)
  return (
    <div className="dialog card downloads" role="dialog" aria-label="Downloads">
      <h2>
        <Download size={18} aria-hidden /> Downloads
        <span className="grow" />
        {s.downloads.some((d) => d.state !== 'progressing' && d.state !== 'paused') && (
          <button className="btn ghost small" onClick={() => call('clearDownloads')}>
            Clear list
          </button>
        )}
      </h2>
      {s.downloads.length === 0 && <p className="fine">Files you download land in your Downloads folder and show up here.</p>}
      <ul className="download-list">
        {s.downloads.map((d) => {
          const pct = d.total ? Math.round((d.received / d.total) * 100) : null
          const active = d.state === 'progressing' || d.state === 'paused'
          return (
            <li key={d.id} className={'download ' + d.state}>
              <button className="dl-main" disabled={d.state !== 'completed'} onClick={() => act(d, 'open')} title={d.state === 'completed' ? 'Open' : d.path}>
                <span className="ellipsis dl-name">{d.name}</span>
                <span className="fine nowrap">
                  {d.state === 'completed'
                    ? `${size(d.total || d.received)} · ${hostOf(d.url)}`
                    : d.state === 'cancelled'
                      ? 'Cancelled'
                      : d.state === 'interrupted'
                        ? 'Failed'
                        : `${size(d.received)}${d.total ? ` of ${size(d.total)}` : ''}${d.state === 'paused' ? ' · paused' : ''}`}
                </span>
                {active && (
                  <span className="dl-bar" aria-hidden>
                    <span style={{ width: pct === null ? '30%' : `${pct}%` }} className={pct === null ? 'indeterminate' : ''} />
                  </span>
                )}
              </button>
              <span className="dl-actions">
                {d.state === 'progressing' && (
                  <button className="icon-btn" aria-label="Pause" title="Pause" onClick={() => act(d, 'pause')}>
                    <Pause size={14} />
                  </button>
                )}
                {d.state === 'paused' && (
                  <button className="icon-btn" aria-label="Resume" title="Resume" onClick={() => act(d, 'resume')}>
                    <Play size={14} />
                  </button>
                )}
                {active && (
                  <button className="icon-btn" aria-label="Cancel" title="Cancel" onClick={() => act(d, 'cancel')}>
                    <X size={15} />
                  </button>
                )}
                {(d.state === 'cancelled' || d.state === 'interrupted') && (
                  <button className="icon-btn" aria-label="Retry" title="Retry" onClick={() => act(d, 'retry')}>
                    <RotateCw size={14} />
                  </button>
                )}
                {d.state === 'completed' && (
                  <button className="icon-btn" aria-label="Show in folder" title="Show in folder" onClick={() => act(d, 'show')}>
                    <FolderOpen size={15} />
                  </button>
                )}
                {!active && (
                  <button className="icon-btn" aria-label="Remove from list" title="Remove from list" onClick={() => act(d, 'remove')}>
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function dayLabel(t: number): string {
  const d = new Date(t)
  const today = new Date()
  const y = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function HistoryView() {
  const [q, setQ] = useState('')
  const [list, setList] = useState<HistoryEntry[]>([])
  const load = () => call<HistoryEntry[]>('listHistory', q).then(setList)
  useEffect(() => {
    void load()
  }, [q])
  const groups: [string, HistoryEntry[]][] = []
  for (const h of list) {
    const label = dayLabel(h.lastVisit)
    const g = groups[groups.length - 1]
    if (g && g[0] === label) g[1].push(h)
    else groups.push([label, [h]])
  }
  const open = (url: string) => call('openTab', url).then(() => call('closeOverlay'))
  return (
    <div className="dialog card history" role="dialog" aria-label="History">
      <h2>
        <History size={18} aria-hidden /> History
      </h2>
      <input className="input" autoFocus placeholder="Search history" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search history" />
      <div className="history-list">
        {list.length === 0 && <p className="fine">{q ? 'No matches.' : 'Pages you visit show up here. Private spaces are never recorded.'}</p>}
        {groups.map(([label, items]) => (
          <section key={label}>
            <h3 className="history-day">{label}</h3>
            <ul>
              {items.map((h) => (
                <li key={h.url} className="history-row">
                  <button className="row" onClick={() => open(h.url)} title={h.url}>
                    <span className="nowrap fine history-time">{new Date(h.lastVisit).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="ellipsis label">{h.title || h.url}</span>
                    <span className="ellipsis fine history-host">{hostOf(h.url)}</span>
                  </button>
                  <button className="icon-btn" aria-label="Remove from history" title="Remove" onClick={() => call('deleteHistory', h.url).then(load)}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="dialog-foot">
        <button className="btn ghost" onClick={() => call('clearBrowsingData', 'site-data')}>
          Clear cookies and site data
        </button>
        <span className="grow" />
        <button className="btn" onClick={() => call('clearBrowsingData', 'history').then(load)}>
          Clear history
        </button>
      </div>
    </div>
  )
}
