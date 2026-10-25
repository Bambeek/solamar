// Import bookmarks and history from Chrome, Edge, Brave, Firefox or Safari on this PC (overlay dialog).
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import type { BrowserSourceInfo } from '@shared/types'
import { call } from './api'

interface Outcome {
  error?: string
  bookmarks?: number
  folders?: number
  history?: number
  skipped?: number
  warnings?: string[]
}

export function ImportBrowsers() {
  const [sources, setSources] = useState<BrowserSourceInfo[] | null>(null)
  const [pick, setPick] = useState(0)
  const [bookmarks, setBookmarks] = useState(true)
  const [history, setHistory] = useState(true)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<Outcome | null>(null)
  useEffect(() => {
    call<BrowserSourceInfo[]>('browserSources').then(setSources)
  }, [])
  const src = sources?.find((x) => x.i === pick)

  const run = async () => {
    if (!src) return
    setBusy(true)
    setOut(await call<Outcome>('browserImport', src.i, { bookmarks: bookmarks && src.has.bookmarks, history: history && src.has.history }))
    setBusy(false)
  }

  return (
    <div className="dialog card import" role="dialog" aria-label="Import from another browser">
      <h2>
        <Download size={18} aria-hidden /> Import from another browser
      </h2>
      {!sources && <p className="fine">Looking for browsers on this PC…</p>}
      {sources?.length === 0 && <p>No Chrome, Edge, Brave, Firefox or Safari profile was found on this PC.</p>}
      {sources && sources.length > 0 && !out && (
        <>
          <p className="fine">Their files are only read, never changed. Bookmarks land in a new space; history joins Solamar's history and the command bar.</p>
          <ul className="source-list" role="radiogroup" aria-label="Browser profile">
            {sources.map((x) => (
              <li key={x.i}>
                <label className={'source' + (x.i === pick ? ' on' : '')}>
                  <input type="radio" name="source" checked={x.i === pick} onChange={() => setPick(x.i)} disabled={x.needsPermission} />
                  <strong>{x.browserName}</strong>
                  <span className="ellipsis">{x.profileName}</span>
                  <span className="fine nowrap">
                    {x.needsPermission ? 'needs Full Disk Access' : [x.has.bookmarks && 'bookmarks', x.has.history && 'history'].filter(Boolean).join(' · ') || 'nothing to import'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label className="check">
            <input type="checkbox" checked={bookmarks} disabled={!src?.has.bookmarks} onChange={(e) => setBookmarks(e.target.checked)} /> Bookmarks
          </label>
          <label className="check">
            <input type="checkbox" checked={history} disabled={!src?.has.history} onChange={(e) => setHistory(e.target.checked)} /> History (latest 5000 pages)
          </label>
          <p className="fine">Close that browser first if it is open, so its history file is not busy. Passwords come in as a CSV file: Settings, Passwords.</p>
        </>
      )}
      {out?.error && <p className="warn">{out.error}</p>}
      {out && !out.error && (
        <div className="import-done">
          <p>
            <strong>Done.</strong> {out.bookmarks ? `${out.bookmarks} bookmarks in ${out.folders} folders went into a new space` : 'No bookmarks were added'}
            {out.history ? `, ${out.history} pages of history were added.` : '.'}
          </p>
          {!!out.skipped && <p className="fine">{out.skipped} bookmarks were left out (duplicates or addresses Solamar cannot open).</p>}
          {out.warnings?.map((w) => (
            <p key={w} className="warn">
              {w}
            </p>
          ))}
        </div>
      )}
      <div className="dialog-foot">
        <span className="grow" />
        <button className="btn" onClick={() => call('closeOverlay')}>
          {out ? 'Close' : 'Cancel'}
        </button>
        {!out && (
          <button className="btn primary" disabled={!src || busy || src.needsPermission || !((bookmarks && src.has.bookmarks) || (history && src.has.history))} onClick={run}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        )}
      </div>
    </div>
  )
}
