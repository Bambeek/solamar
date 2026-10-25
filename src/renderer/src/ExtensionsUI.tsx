// Chrome extensions in Solamar's UI: the toolbar under the address, the "Add extension?" card and Settings > Extensions.
import { Puzzle, ShieldCheck, Trash2 } from 'lucide-react'
import type { AppState } from '@shared/types'
import { call } from './api'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      // Web component from electron-chrome-extensions (injected by the UI preload).
      'browser-action-list': { partition?: string; tab?: string; alignment?: string; class?: string }
    }
  }
}

/** Extension buttons for the active tab (popups open under them); nothing when no extension is loaded. */
export function ExtensionBar({ s }: { s: AppState }) {
  if (!s.extensions.length || s.activeWcId === null) return null
  return <browser-action-list class="ext-bar no-drag" partition={s.activePartition} tab={String(s.activeWcId)} alignment="bottom right" />
}

const iconUrl = (s: AppState, id: string) => `crx://extension-icon/${id}/32/2?partition=${encodeURIComponent(s.activePartition)}`

export function ExtensionInstallCard({ s }: { s: AppState }) {
  const p = s.extensionInstall
  if (!p) return null
  const decide = (ok: boolean) => call('extensionDecide', p.id, ok)
  return (
    <div className="dialog card ext-install" role="alertdialog" aria-labelledby="ext-title">
      <div className="ext-install-head">
        {p.icon ? <img src={p.icon} width={40} height={40} alt="" /> : <Puzzle size={32} aria-hidden />}
        <h2 id="ext-title">Add “{p.name}” to Solamar?</h2>
      </div>
      {p.permissions.length > 0 ? (
        <>
          <p className="fine">It will be able to:</p>
          <ul className="ext-perms">
            {p.permissions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="fine">It asks for no special access.</p>
      )}
      <p className="fine">
        <ShieldCheck size={13} aria-hidden /> Extensions run in your saved profiles, never in private spaces. Remove it any time in Settings, Extensions.
      </p>
      <div className="dialog-foot">
        <span className="grow" />
        <button className="btn" onClick={() => decide(false)}>
          Cancel
        </button>
        <button className="btn primary" autoFocus onClick={() => decide(true)}>
          Add extension
        </button>
      </div>
    </div>
  )
}

export function ExtensionSettings({ s }: { s: AppState }) {
  return (
    <>
      <p>
        Solamar runs Chrome extensions (Manifest V3) from the Chrome Web Store: open the store, pick one and press <strong>Add to Chrome</strong>. They update on their own.
      </p>
      <button className="btn primary" onClick={() => call('openTab', 'https://chromewebstore.google.com/').then(() => call('closeOverlay'))}>
        <Puzzle size={14} aria-hidden /> Open the Chrome Web Store
      </button>
      <p className="fine">Extensions are shared by your saved profiles and stay off in private spaces. A few Chrome-only features may not work yet.</p>
      <ul className="allow-list ext-list">
        {s.extensions.length === 0 && <li className="fine">No extensions yet.</li>}
        {s.extensions.map((e) => (
          <li key={e.id}>
            <img src={iconUrl(s, e.id)} width={20} height={20} alt="" onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')} />
            <span className="ext-name">
              <strong className="ellipsis">{e.name}</strong>
              <span className="fine ellipsis">
                {e.version}
                {e.description ? ` · ${e.description}` : ''}
              </span>
            </span>
            <button className="icon-btn" aria-label={'Remove ' + e.name} title="Remove" onClick={() => call('extensionRemove', e.id)}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
