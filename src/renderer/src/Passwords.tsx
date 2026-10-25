// "Save password?" card after a login, the master-password unlock card, and the Passwords tab in Settings (protection,
// list, copy, show, edit, delete, CSV import).
import { useEffect, useRef, useState } from 'react'
import { Copy, Eye, EyeOff, KeyRound, Lock, Pencil, ShieldCheck, Trash2, Upload, X } from 'lucide-react'
import type { AppState, LoginInfo } from '@shared/types'
import { hostOf } from '@shared/util'
import { call } from './api'
import '../styles/passwords.css'

export function SavePasswordCard({ s }: { s: AppState }) {
  const p = s.savePassword
  if (!p) return null
  const decide = (answer: 'save' | 'never' | 'dismiss') => call('savePasswordDecide', answer)
  return (
    <div className="permission card" role="alertdialog" aria-labelledby="save-pw-title">
      <div className="permission-head">
        <span className="permission-icon">
          <KeyRound size={16} aria-hidden />
        </span>
        <p id="save-pw-title">
          {p.update ? 'Update the saved password' : 'Save password'} for <strong>{p.site}</strong>
          {p.username && <span className="fine block ellipsis">{p.username}</span>}
          {p.locked && <span className="fine block">Saving asks for your master password.</span>}
        </p>
        <button className="icon-btn" aria-label="Not now" title="Not now (Esc)" onClick={() => decide('dismiss')}>
          <X size={15} />
        </button>
      </div>
      <div className="permission-foot">
        {!p.update && (
          <button className="btn ghost" onClick={() => decide('never')}>
            Never for this site
          </button>
        )}
        <button className="btn primary" onClick={() => decide('save')}>
          {p.update ? 'Update' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/** "Unlock saved passwords" when a page wants a login filled (or one saved) while the master password locks the vault. */
export function VaultUnlockCard({ s }: { s: AppState }) {
  const site = s.overlay?.payload?.text ?? ''
  const saving = s.overlay?.payload?.mode === 'new'
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const submit = async () => {
    if (!pw || busy) return
    setBusy(true)
    const ok = await call<boolean>('vaultUnlock', pw)
    setBusy(false)
    if (!ok) {
      setWrong(true)
      setPw('')
    }
  }
  return (
    <form
      className="permission card vault-card"
      role="dialog"
      aria-labelledby="vault-title"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="permission-head">
        <span className="permission-icon">
          <Lock size={16} aria-hidden />
        </span>
        <p id="vault-title">
          Unlock saved passwords
          {site && <span className="fine block ellipsis">{saving ? `to save your login for ${site}` : `to fill your login on ${site}`}</span>}
        </p>
        <button type="button" className="icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={() => call('closeOverlay')}>
          <X size={15} />
        </button>
      </div>
      <input
        className="input"
        type="password"
        autoFocus
        placeholder="Master password"
        aria-label="Master password"
        autoComplete="current-password"
        value={pw}
        onChange={(e) => (setPw(e.target.value), setWrong(false))}
      />
      {wrong && <p className="warn vault-wrong">That is not your master password.</p>}
      <div className="permission-foot">
        <button type="button" className="btn ghost" onClick={() => call('closeOverlay')}>
          Cancel
        </button>
        <button className="btn primary" disabled={!pw || busy}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </div>
    </form>
  )
}

const LOCK_AFTER: [number, string][] = [
  [5, 'after 5 minutes'],
  [15, 'after 15 minutes'],
  [60, 'after 1 hour'],
  [0, 'only when Solamar closes']
]

/** The top of the Passwords tab: how Solamar confirms it is you, and the optional master password. */
function VaultProtection({ s }: { s: AppState }) {
  const p = s.passwords
  const st = s.settings.passwords
  const [mode, setMode] = useState<'idle' | 'set' | 'change' | 'remove'>('idle')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [unlockPw, setUnlockPw] = useState('')
  const [err, setErr] = useState('')
  const reset = () => (setMode('idle'), setCurrent(''), setNext(''), setAgain(''), setErr(''))
  const confirmText =
    p.osAuth === 'windows-hello'
      ? 'Showing or copying a password asks for Windows Hello first: your PIN, face or fingerprint.'
      : p.osAuth === 'touch-id'
        ? 'Showing or copying a password asks for Touch ID first.'
        : p.master
          ? 'Showing or copying a password asks for your master password first (this computer has no Windows Hello or Touch ID set up).'
          : 'This computer has no Windows Hello or Touch ID set up, so Solamar cannot check it is you before showing a password. Set a master password below, or set up a Windows Hello PIN.'

  const unlock = async () => {
    if (!unlockPw) return
    const ok = await call<boolean>('vaultUnlock', unlockPw)
    setUnlockPw('')
    setErr(ok ? '' : 'That is not your master password.')
  }
  const saveMaster = async () => {
    if (next !== again) return setErr('The two new passwords are different.')
    const r = await call<{ ok?: boolean; error?: string }>('vaultSetMaster', next, current || undefined)
    if (r.error) return setErr(r.error)
    reset()
  }
  const removeMaster = async () => {
    const r = await call<{ ok?: boolean; error?: string }>('vaultRemoveMaster', current)
    if (r.error) return setErr(r.error)
    reset()
  }

  return (
    <div className="pw-protect">
      <p className="fine">{confirmText}</p>
      {p.master && p.locked ? (
        <form
          className="pw-lockbar"
          onSubmit={(e) => {
            e.preventDefault()
            void unlock()
          }}
        >
          <Lock size={16} aria-hidden />
          <span>Saved passwords are locked.</span>
          <input className="input" type="password" placeholder="Master password" aria-label="Master password" autoComplete="current-password" value={unlockPw} onChange={(e) => (setUnlockPw(e.target.value), setErr(''))} />
          <button className="btn primary small" disabled={!unlockPw}>
            Unlock
          </button>
        </form>
      ) : p.master ? (
        <div className="pw-master">
          <ShieldCheck size={18} aria-hidden className="pw-master-icon on" />
          <div className="pw-master-text">
            <strong>Master password is on</strong>
            <span className="fine">Locks when Solamar closes, when the computer locks or sleeps, and when idle:</span>
          </div>
          <select className="input" value={st.lockAfter} onChange={(e) => call('updateSettings', { passwords: { lockAfter: Number(e.target.value) } })} aria-label="Lock when idle">
            {LOCK_AFTER.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <div className="pw-master-actions">
            <button className="btn small" onClick={() => call('vaultLock')}>
              <Lock size={13} aria-hidden /> Lock now
            </button>
            <button className="btn small" onClick={() => (reset(), setMode('change'))}>
              Change
            </button>
            <button className="btn link small" onClick={() => (reset(), setMode('remove'))}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="pw-master">
          <ShieldCheck size={18} aria-hidden className="pw-master-icon" />
          <div className="pw-master-text">
            <strong>Master password</strong>
            <span className="fine">Optional: saved passwords stay locked until you type it, so other programs on this computer cannot read them.</span>
          </div>
          <div className="pw-master-actions">
            <button className="btn small" onClick={() => (reset(), setMode('set'))}>
              Set a master password
            </button>
          </div>
        </div>
      )}
      {(mode === 'set' || mode === 'change') && (
        <form
          className="pw-master-form"
          onSubmit={(e) => {
            e.preventDefault()
            void saveMaster()
          }}
        >
          {mode === 'change' && (
            <input className="input" type="password" placeholder="Current master password" aria-label="Current master password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          )}
          <input className="input" type="password" placeholder="New master password (at least 8 characters)" aria-label="New master password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <input className="input" type="password" placeholder="The same again" aria-label="Repeat the new master password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          <p className="fine">A few unrelated words make a strong one. If you forget it, your saved passwords cannot be recovered: Solamar does not keep it anywhere.</p>
          <div className="row-btns">
            <button className="btn primary small" disabled={next.length < 8 || !again || (mode === 'change' && !current)}>
              {mode === 'set' ? 'Set master password' : 'Change master password'}
            </button>
            <button type="button" className="btn small" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {mode === 'remove' && (
        <form
          className="pw-master-form"
          onSubmit={(e) => {
            e.preventDefault()
            void removeMaster()
          }}
        >
          <input className="input" type="password" placeholder="Current master password" aria-label="Current master password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <p className="fine">Without a master password, saved passwords are protected by your Windows account only.</p>
          <div className="row-btns">
            <button className="btn small" disabled={!current}>
              Remove master password
            </button>
            <button type="button" className="btn small" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {err && <p className="warn">{err}</p>}
    </div>
  )
}

type Revealed = { password: string } | { error: 'locked' | 'denied' | 'need-master' | 'missing' }

interface CsvResult {
  error?: string
  format?: string
  added?: number
  updated?: number
  same?: number
  skipped?: number
}

export function PasswordSettings({ s }: { s: AppState }) {
  const st = s.settings.passwords
  const [q, setQ] = useState('')
  const [list, setList] = useState<LoginInfo[]>([])
  const [shown, setShown] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [msg, setMsg] = useState<CsvResult | null>(null)
  const [ask, setAsk] = useState<{ id: string; action: 'show' | 'copy' } | null>(null) // waiting for the master password
  const [askPw, setAskPw] = useState('')
  const [note, setNote] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const load = () => call<LoginInfo[]>('passwordsList', q).then(setList)
  useEffect(() => {
    void load()
  }, [q, s.passwords.count])

  // Show and Copy first confirm it is you (Windows Hello / Touch ID); the master password where that is not possible.
  const answer = (r: Revealed | { ok?: boolean; error?: string }, id: string, action: 'show' | 'copy') => {
    if ('error' in r && (r.error === 'locked' || r.error === 'need-master')) return setAsk({ id, action }), setNote('')
    if ('error' in r && r.error === 'denied') return setNote('Not confirmed, so the password stays hidden.')
    setAsk(null)
    setAskPw('')
    if (action === 'copy') return setNote('Password copied. It is cleared from the clipboard after 30 seconds.')
    if ('password' in r) {
      const pw = r.password
      setShown((m) => ({ ...m, [id]: pw }))
      setTimeout(() => setShown(({ [id]: _, ...rest }) => rest), 20_000) // hides itself again
    }
  }
  const reveal = async (id: string, master?: string) => {
    if (shown[id] !== undefined && !master) return setShown(({ [id]: _, ...rest }) => rest)
    answer(await call<Revealed>('passwordReveal', id, master), id, 'show')
  }
  const copyPassword = async (id: string, master?: string) => answer(await call<{ ok?: boolean; error?: string }>('passwordCopy', id, 'password', master), id, 'copy')
  const importCsv = async (f: File) => {
    setMsg(await call<CsvResult>('passwordsImportCsv', await f.text()))
    if (file.current) file.current.value = ''
  }

  if (!s.passwords.available)
    return <p>This computer has no usable keychain (Windows data protection, macOS Keychain or a Linux secret service), so Solamar does not store passwords here.</p>

  return (
    <>
      <label className="check">
        <input type="checkbox" checked={st.offer} onChange={(e) => call('updateSettings', { passwords: { offer: e.target.checked } })} /> Offer to save passwords after I sign in
      </label>
      <p className="fine">
        Saved passwords are encrypted twice: each one on its own, and all of them together with this computer's keychain. They fill only on the site they were saved for, when you
        pick one under the login field. Private spaces never save them. Claude Code and other agents cannot read or fill them.
      </p>
      <VaultProtection s={s} />
      <div className="pw-tools">
        <input className="input" placeholder={`Search ${s.passwords.count} saved logins`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search saved logins" />
        <button className="btn" onClick={() => file.current?.click()} title="A CSV exported from another browser or password manager">
          <Upload size={14} aria-hidden /> Import CSV
        </button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
      </div>
      {msg?.error && <p className="warn">{msg.error}</p>}
      {msg && !msg.error && (
        <p className="fine">
          Imported from a {msg.format} file: {msg.added} new, {msg.updated} updated, {msg.same} already saved{msg.skipped ? `, ${msg.skipped} rows skipped` : ''}. Delete the CSV
          file now: it holds your passwords in plain text.
        </p>
      )}
      {ask && (
        <form
          className="pw-ask"
          onSubmit={(e) => {
            e.preventDefault()
            void (ask.action === 'show' ? reveal(ask.id, askPw) : copyPassword(ask.id, askPw))
          }}
        >
          <Lock size={14} aria-hidden />
          <span>Type your master password to {ask.action === 'show' ? 'show' : 'copy'} it</span>
          <input className="input" type="password" autoFocus aria-label="Master password" autoComplete="current-password" value={askPw} onChange={(e) => setAskPw(e.target.value)} />
          <button className="btn primary small" disabled={!askPw}>
            OK
          </button>
          <button type="button" className="btn small" onClick={() => (setAsk(null), setAskPw(''))}>
            Cancel
          </button>
        </form>
      )}
      {note && <p className="fine">{note}</p>}
      <ul className="pw-list">
        {list.length === 0 && <li className="fine">{q ? 'No matches.' : 'No saved passwords yet.'}</li>}
        {list.map((l) =>
          editing === l.id ? (
            <EditRow key={l.id} l={l} done={() => (setEditing(null), load())} />
          ) : (
            <li key={l.id} className="pw-row">
              <span className="pw-site ellipsis" title={l.origin}>
                {hostOf(l.origin)}
              </span>
              <span className="pw-user ellipsis">{l.username || <em className="fine">no username</em>}</span>
              <code className="pw-pass ellipsis">{shown[l.id] ?? '••••••••'}</code>
              <span className="pw-actions">
                <button className="icon-btn" aria-label="Copy username" title="Copy username" onClick={() => call('passwordCopy', l.id, 'username')}>
                  <Copy size={14} />
                </button>
                <button className="icon-btn" aria-label="Copy password" title="Copy password (cleared from the clipboard after 30 s)" onClick={() => copyPassword(l.id)}>
                  <KeyRound size={14} />
                </button>
                <button className="icon-btn" aria-label={shown[l.id] !== undefined ? 'Hide password' : 'Show password'} title={shown[l.id] !== undefined ? 'Hide' : 'Show'} onClick={() => reveal(l.id)}>
                  {shown[l.id] !== undefined ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button className="icon-btn" aria-label="Edit" title="Edit" onClick={() => setEditing(l.id)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-btn" aria-label={'Delete login for ' + hostOf(l.origin)} title="Delete" onClick={() => call('passwordDelete', l.id).then(load)}>
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          )
        )}
      </ul>
      {st.never.length > 0 && (
        <div className="field">
          <span>Never offered on</span>
          <ul className="allow-list">
            {st.never.map((d) => (
              <li key={d}>
                <span>{d}</span>
                <button className="btn link small" onClick={() => call('updateSettings', { passwords: { never: st.never.filter((x) => x !== d) } })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function EditRow({ l, done }: { l: LoginInfo; done: () => void }) {
  const [user, setUser] = useState(l.username)
  const [pw, setPw] = useState('')
  return (
    <li className="pw-row editing">
      <form
        className="pw-edit"
        onSubmit={(e) => {
          e.preventDefault()
          call('passwordUpdate', l.id, { username: user, password: pw || undefined }).then(done)
        }}
      >
        <span className="pw-site ellipsis">{hostOf(l.origin)}</span>
        <input className="input" value={user} onChange={(e) => setUser(e.target.value)} aria-label="Username" />
        <input className="input" type="password" placeholder="New password (empty: keep)" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="New password" autoComplete="new-password" />
        <button className="btn primary small">Save</button>
        <button type="button" className="btn small" onClick={done}>
          Cancel
        </button>
      </form>
    </li>
  )
}
