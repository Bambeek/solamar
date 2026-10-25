// Renderer #overlay: transparent view above the page for the command bar and dialogs.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, ArrowRight, ChevronRight, Columns2, FolderOpen, Download, Globe, History, Info, Keyboard, KeyRound, Loader2, Puzzle, Search, Palette, ShieldCheck, SlidersHorizontal, Sparkles, SquareArrowOutUpRight, SquareTerminal, Trash2, Upload, X, Zap } from 'lucide-react'
import { APP_ICONS, COMMAND_LABELS, DEFAULT_SHORTCUTS, SEARCH_ENGINES, THEME_PRESETS } from '@shared/defaults'
import type { AppIconId, AppState, ArcPreview, ArchivedItem, CommandId, CommandResult, ImportSummary, Space, SpaceTheme, Texture, ThemeMode, UpdateState } from '@shared/types'
import { DEFAULT_SPACE_ICONS, SPACE_ICONS, isSpaceIcon } from '@shared/icons'
import { accelerator, hostOf, looksLikeQuestion, searchUrl } from '@shared/util'
import { call, useAppState, useSystemDark } from './api'
import { AiSettings, ClaudeCodeSettings, ConfirmCard } from './AgentUI'
import { AnswerPanel, engineName, WriteView } from './AssistUI'
import { Guard } from './Frame'
import { ImportBrowsers } from './ImportBrowsers'
import { ExtensionInstallCard, ExtensionSettings } from './ExtensionsUI'
import { PasswordSettings, SavePasswordCard, VaultUnlockCard } from './Passwords'
import { DownloadsView, HistoryView } from './LibraryViews'
import { PermissionCard, SitePermissions } from './PermissionCard'
import { ICONS, SpaceIcon } from './SpaceIcon'
import { applyTheme, themeVars } from './theme'
import artBottle from './assets/settings/bottle.webp'
import artBoxes from './assets/settings/boxes.webp'
import artCompass from './assets/settings/compass.webp'
import artGull from './assets/settings/gull.webp'
import artGullPeek from './assets/settings/gull-peek.webp'
import artHelm from './assets/settings/helm.webp'
import artLighthouse from './assets/settings/lighthouse.webp'
import artPaint from './assets/settings/paint.webp'
import artPainter from './assets/settings/painter.webp'
import iconDay from './assets/app-icons/day.svg'
import iconInk from './assets/app-icons/ink.svg'
import iconNight from './assets/app-icons/night.svg'
import iconSunset from './assets/app-icons/sunset.svg'
import iconViolet from './assets/app-icons/violet.svg'
import artPuzzle from './assets/settings/puzzle.webp'
import artShield from './assets/settings/shield.webp'
import artVault from './assets/settings/vault.webp'
import { composing } from './keys'

export function Overlay() {
  const s = useAppState()
  const dark = useSystemDark()
  const space = s?.spaces.find((x) => x.id === s.window.focusedSpaceId)
  useEffect(() => {
    applyTheme(document.documentElement, space, dark, s?.settings.layout)
  }, [space, dark, s?.settings.layout])
  if (!s?.overlay) return null
  const close = () => call('closeOverlay')
  const k = s.overlay.kind
  if (k === 'resize') return <ResizeCapture />
  if (k === 'permission') return <PermissionCard s={s} />
  if (k === 'peek') return <PeekFrame s={s} />
  if (k === 'notice') return <NoticeToast s={s} />
  if (k === 'save-password') return <SavePasswordCard s={s} />
  if (k === 'vault-unlock') return <VaultUnlockCard s={s} />
  const key = k + (s.overlay.payload?.tab ?? '') + (s.overlay.payload?.spaceId ?? '') + (s.overlay.payload?.mode ?? '')
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && k !== 'confirm' && close()}>
      <Guard name="dialog" key={key}>
      {k === 'command' && <CommandBar key={key} s={s} />}
      {k === 'theme' && <ThemeEditor key={key} s={s} />}
      {k === 'space-new' && <ThemeEditor key={key} s={s} isNew />}
      {k === 'import' && <ImportArc key={key} s={s} />}
      {k === 'import-browser' && <ImportBrowsers key={key} />}
      {k === 'extension-install' && <ExtensionInstallCard s={s} />}
      {k === 'archive' && <ArchiveView key={key} />}
      {k === 'history' && <HistoryView key={key} />}
      {k === 'downloads' && <DownloadsView key={key} s={s} />}
      {k === 'settings' && <SettingsView key={key} s={s} />}
      {k === 'confirm' && <ConfirmCard s={s} />}
      {k === 'write' && <WriteView key={key} s={s} />}
      </Guard>
      {s.notice && <NoticeToast s={s} inDialog />}
    </div>
  )
}

// ---------- notices ----------

/** A short message (saved page, crash restore...) at the bottom of the window, above the page. */
function NoticeToast({ s, inDialog = false }: { s: AppState; inDialog?: boolean }) {
  const n = s.notice
  if (!n) return null
  return (
    <div className={'notice-host' + (inDialog ? ' in-dialog' : '')} onMouseDown={(e) => e.stopPropagation()}>
      <div className={'notice-toast' + (n.error ? ' error' : '')} role="status" key={n.id}>
        <span>{n.text}</span>
        {n.path && (
          <button className="btn small" onClick={() => call('openClipFolder', n.path)}>
            <FolderOpen size={14} aria-hidden /> Open folder
          </button>
        )}
        {n.action && (
          <button className="btn small primary" onClick={() => call(n.action!.call)}>
            {n.action.label}
          </button>
        )}
        <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => call('dismissNotice')}>
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

// ---------- peek ----------

/** The card around a peeked page (the page itself is a view the main process lays inside it). */
function PeekFrame({ s }: { s: AppState }) {
  const p = s.peek
  if (!p) return null
  const r = p.rect
  return (
    <div className="backdrop peek-backdrop" onMouseDown={(e) => e.target === e.currentTarget && call('closeOverlay')}>
      <div className="peek-card" style={{ left: r.x - 6, top: r.y - 46, width: r.width + 12, height: r.height + 52 }} role="dialog" aria-label={'Peek: ' + p.title}>
        <header className="peek-bar">
          {p.loading ? <Loader2 size={14} className="spin" aria-label="Loading" /> : <Globe size={14} aria-hidden />}
          <span className="ellipsis peek-title">{p.title || hostOf(p.url)}</span>
          <span className="ellipsis fine">{hostOf(p.url)}</span>
          <span className="grow" />
          <button className="icon-btn" title="Open in split view" aria-label="Open in split view" onClick={() => call('promotePeek', true)}>
            <Columns2 size={15} />
          </button>
          <button className="btn small" title="Keep it as a tab" onClick={() => call('promotePeek', false)}>
            <SquareArrowOutUpRight size={13} aria-hidden /> Open as tab
          </button>
          <button className="icon-btn" title="Close (Esc)" aria-label="Close peek" onClick={() => call('closeOverlay')}>
            <X size={16} />
          </button>
        </header>
      </div>
    </div>
  )
}

// ---------- sidebar resize ----------

/** Full-window, invisible layer that follows the mouse while the sidebar edge is dragged. */
function ResizeCapture() {
  useEffect(() => {
    let frame = 0
    let x = -1
    const end = () => call('closeOverlay')
    const move = (e: PointerEvent) => {
      if (e.buttons === 0) return end() // released before this layer appeared
      x = e.clientX
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          call('setSidebarWidth', x)
        })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('blur', end)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('blur', end)
    }
  }, [])
  return <div className="resize-capture" />
}

// ---------- command bar ----------

function CommandBar({ s }: { s: AppState }) {
  const p = s.overlay?.payload ?? {}
  const renaming = !!p.tab
  const edit = p.mode === 'edit' && !renaming
  const [text, setText] = useState(p.text ?? '')
  const [results, setResults] = useState<CommandResult[]>([])
  const [better, setBetter] = useState<{ for: string; query: string } | null>(null)
  const [improving, setImproving] = useState(false)
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const unchanged = edit && text === p.text
  const aiOn = s.settings.ai.enabled && !renaming && !unchanged && looksLikeQuestion(text)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  useEffect(() => {
    if (renaming) return
    let live = true
    call<CommandResult[]>('query', unchanged ? '' : text).then((r) => {
      if (!live) return
      setResults(unchanged ? [] : r)
      setSel(0)
    })
    if (s.answer) call('aiAnswerClear')
    return () => {
      live = false
    }
  }, [text])
  // A better query from AI once typing pauses; only for natural-language input.
  useEffect(() => {
    if (!aiOn) return setImproving(false)
    let live = true
    const q = text
    const t = setTimeout(() => {
      setImproving(true)
      call<string | null>('aiRewrite', q).then((r) => {
        if (!live) return
        setImproving(false)
        setBetter(r ? { for: q, query: r } : null)
      })
    }, 700)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [text, aiOn])

  const rows: CommandResult[] = [...results]
  if (aiOn) {
    const at = results[0]?.id === 'nav' ? 1 : 0
    const extra: CommandResult[] = [{ id: 'ai-ask', kind: 'action', action: 'ai-ask', title: `Ask AI: ${text.trim()}`, subtitle: engineName(s, 'search'), score: 900 }]
    if (better && better.for === text)
      extra.push({ id: 'ai-better', kind: 'search', title: better.query, subtitle: 'Better search (Tab)', url: searchUrl(better.query, s.settings.searchEngine), score: 899 })
    rows.splice(at, 0, ...extra)
  }

  const go = (r: CommandResult | undefined, newTab: boolean) => {
    if (renaming) {
      call('rename', p.tab, text)
      return call('closeOverlay')
    }
    if (r?.id === 'ai-ask') return call('aiAnswer', text)
    if (!r) {
      if (edit && text.trim()) return call('query', text).then((rs) => call('pick', (rs as CommandResult[])[0], !newTab))
      return call('closeOverlay')
    }
    call('pick', r, edit && !newTab)
  }

  return (
    <div className="command card" role="dialog" aria-label={renaming ? 'Rename' : 'Command bar'}>
      <div className="command-input">
        {renaming ? <span className="cmd-label">Rename</span> : <Search size={18} aria-hidden />}
        <input
          ref={input}
          value={text}
          spellCheck={false}
          placeholder={renaming ? 'Name' : 'Search, ask AI, enter an address, or type > for actions'}
          aria-label={renaming ? 'New name' : 'Search or address'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (composing(e)) return
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((i) => Math.min(rows.length - 1, i + 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((i) => Math.max(0, i - 1)))
            else if (e.key === 'Tab' && better?.for === text) (e.preventDefault(), setText(better.query))
            else if (e.key === 'Enter') (e.preventDefault(), go(rows[sel], e.shiftKey || e.altKey))
          }}
        />
        {improving && <Sparkles size={15} className="improving" aria-label="AI is improving the search" />}
      </div>
      {!renaming && s.answer && <AnswerPanel s={s} />}
      {!renaming && !s.answer && rows.length > 0 && (
        <ul className="results" role="listbox">
          {rows.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === sel}
              className={'result' + (i === sel ? ' sel' : '') + (r.id.startsWith('ai-') ? ' ai' : '')}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => (e.preventDefault(), go(r, false))}
            >
              <ResultIcon r={r} />
              <span className="ellipsis title">{r.title}</span>
              {r.subtitle && <span className="ellipsis sub">{r.subtitle}</span>}
              <span className="kind">{r.kind === 'tab' ? 'Switch to tab' : r.kind === 'action' && !r.id.startsWith('ai-') ? 'Action' : ''}</span>
              {i === sel && <ArrowRight size={14} className="enter" aria-hidden />}
            </li>
          ))}
        </ul>
      )}
      {!renaming && (
        <div className="command-foot">
          <span>
            <kbd>Enter</kbd> {edit ? 'open here' : 'open'}
          </span>
          <span>
            <kbd>Shift+Enter</kbd> new tab
          </span>
          {aiOn && (
            <span>
              <kbd>Tab</kbd> use better search
            </span>
          )}
          <span>
            <kbd>&gt;</kbd> actions
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      )}
    </div>
  )
}

function ResultIcon({ r }: { r: CommandResult }) {
  const [broken, setBroken] = useState(false)
  if (r.id.startsWith('ai-')) return <Sparkles size={16} aria-hidden className="ai-icon" />
  if (r.favicon && !broken) return <img className="favicon" src={r.favicon} width={16} height={16} alt="" onError={() => setBroken(true)} />
  if (r.kind === 'search') return <Search size={16} aria-hidden />
  if (r.kind === 'history') return <History size={16} aria-hidden />
  if (r.kind === 'action') return <Zap size={16} aria-hidden />
  return <Globe size={16} aria-hidden />
}

// ---------- theme editor / new space ----------

function ThemeEditor({ s, isNew }: { s: AppState; isNew?: boolean }) {
  const dark = useSystemDark()
  const target: Space | undefined = isNew ? undefined : s.spaces.find((x) => x.id === (s.overlay?.payload?.spaceId ?? s.window.focusedSpaceId))
  const [title, setTitle] = useState(target?.title ?? '')
  const [icon, setIcon] = useState<string>(target?.icon ?? DEFAULT_SPACE_ICONS[s.spaces.length % DEFAULT_SPACE_ICONS.length])
  const [theme, setTheme] = useState<SpaceTheme>(target?.theme ?? { ...THEME_PRESETS[s.spaces.length % THEME_PRESETS.length] })
  const [msg, setMsg] = useState('')
  const file = useRef<HTMLInputElement>(null)

  // Edits apply live to the real window; a new space previews inside the dialog.
  const update = (t: SpaceTheme) => {
    setTheme(t)
    if (target) call('updateSpace', target.id, { theme: t })
  }
  const set = <K extends keyof SpaceTheme>(k: K, v: SpaceTheme[K]) => update({ ...theme, [k]: v })

  const exportTheme = () => {
    const blob = new Blob([JSON.stringify({ solamarTheme: 1, name: title || 'Space', icon, theme }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(title || 'space').replace(/[^\w-]+/g, '-').toLowerCase()}.solamar-theme.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  const importTheme = async (f: File) => {
    try {
      const data = JSON.parse(await f.text())
      const t = data?.theme
      // harborTheme: files exported under the working name still load.
      if ((data?.solamarTheme ?? data?.harborTheme) !== 1 || !t || typeof t.color !== 'string') throw new Error()
      update({ color: t.color, color2: t.color2, mode: t.mode ?? 'auto', texture: t.texture ?? 'none', intensity: Number(t.intensity ?? 0.7) })
      if (isSpaceIcon(data.icon)) setIcon(data.icon)
      setMsg(`Loaded "${data.name ?? 'theme'}"`)
    } catch {
      setMsg('That file is not a Solamar theme.')
    }
  }

  const save = () => {
    if (isNew) call('createSpace', { title: title || 'Space', icon, theme })
    else if (target) call('updateSpace', target.id, { title, icon })
    call('closeOverlay')
  }
  const preview = isNew ? (themeVars(theme, dark) as React.CSSProperties) : undefined

  return (
    <div className="dialog card theme-editor" role="dialog" aria-label={isNew ? 'New space' : 'Edit space'}>
      <h2>{isNew ? 'New space' : 'Space'}</h2>
      {isNew && (
        <div className="preview" style={preview} data-mode={preview ? (preview as any)['data-mode'] : undefined}>
          <SpaceIcon id={icon} size={20} />
          <span>{title || 'Space'}</span>
        </div>
      )}
      <label className="field">
        <span>Name</span>
        <input className="input" autoFocus value={title} maxLength={40} placeholder="Work, Fun, Research…" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !composing(e) && save()} />
      </label>
      <div className="field">
        <span>Icon</span>
        <div className="icon-pick" role="radiogroup" aria-label="Space icon">
          {SPACE_ICONS.filter((id) => id in ICONS).map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={id === icon}
              className={'icon-choice' + (id === icon ? ' on' : '')}
              title={id}
              aria-label={id}
              onClick={() => {
                setIcon(id)
                if (target) call('updateSpace', target.id, { icon: id })
              }}
            >
              <SpaceIcon id={id} size={16} />
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Colour</span>
        <div className="swatches">
          {THEME_PRESETS.map((p, i) => (
            <button
              key={i}
              className={'swatch' + (p.color === theme.color && p.color2 === theme.color2 ? ' on' : '')}
              style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color2 ?? p.color})` }}
              aria-label={`Preset ${i + 1}`}
              onClick={() => update({ ...p })}
            />
          ))}
          <label className="swatch custom" title="Custom colour">
            <input type="color" value={theme.color} onChange={(e) => set('color', e.target.value)} aria-label="Main colour" />
          </label>
          <label className="swatch custom" title="Second gradient colour">
            <input type="color" value={theme.color2 ?? theme.color} onChange={(e) => set('color2', e.target.value)} aria-label="Second colour" />
          </label>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <span>Mode</span>
          <Segmented<ThemeMode> value={theme.mode} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => set('mode', v)} />
        </div>
        <div className="field">
          <span>Texture</span>
          <Segmented<Texture> value={theme.texture} options={[['none', 'None'], ['grain', 'Grain'], ['dots', 'Dots']]} onChange={(v) => set('texture', v)} />
        </div>
      </div>
      <label className="field">
        <span>Intensity</span>
        <input type="range" min={0} max={1} step={0.05} value={theme.intensity} onChange={(e) => set('intensity', Number(e.target.value))} />
      </label>

      <div className="dialog-foot">
        <button className="btn ghost" onClick={exportTheme} title="Save this theme as a file to share">
          <Download size={14} /> Export
        </button>
        <button className="btn ghost" onClick={() => file.current?.click()} title="Load a .solamar-theme.json file">
          <Upload size={14} /> Import
        </button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importTheme(e.target.files[0])} />
        <span className="fine grow">{msg}</span>
        <button className="btn" onClick={() => call('closeOverlay')}>
          {isNew ? 'Cancel' : 'Close'}
        </button>
        <button className="btn primary" onClick={save}>
          {isNew ? 'Create space' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

// ---------- Arc import ----------

function ImportArc({ s }: { s: AppState }) {
  const [scan, setScan] = useState<{ found: boolean; preview?: ArcPreview; error?: string } | null>(null)
  const [today, setToday] = useState(true)
  const [result, setResult] = useState<{ summary?: ImportSummary; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    call<typeof scan>('arcScan').then(setScan)
  }, [])

  const run = async () => {
    setBusy(true)
    setResult(await call('arcImport', { includeToday: today }))
    setBusy(false)
  }
  const p = scan?.preview

  return (
    <div className="dialog card import" role="dialog" aria-label="Import from Arc">
      <h2>Import from Arc</h2>
      {!scan && <p className="fine">Looking for Arc on this PC…</p>}
      {scan && !scan.found && (
        <p>
          Arc was not found on this PC. Solamar reads Arc's sidebar file from its install folder; nothing is downloaded or sent anywhere.
        </p>
      )}
      {scan?.error && <p className="warn">{scan.error}</p>}
      {p && !result && (
        <>
          <p className="fine">
            Found Arc data. Your Arc files are only read, never changed. Logins and passwords stay in Arc; export them from Arc if you need them.
          </p>
          <ul className="arc-spaces">
            {p.spaces.map((sp, i) => (
              <li key={i}>
                <span className="dot big" style={{ background: sp.color ?? 'var(--color-accent)' }}>
                  <SpaceIcon id={sp.icon} size={15} />
                </span>
                <strong className="ellipsis">{sp.title}</strong>
                <span className="fine">
                  {sp.pinned} pinned · {sp.today} today · {sp.folders} folders
                </span>
              </li>
            ))}
          </ul>
          <p className="fine">{p.favorites} favorites</p>
          <label className="check">
            <input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)} /> Also bring unpinned (today) tabs
          </label>
        </>
      )}
      {result?.summary && (
        <p className="ok">
          Imported {result.summary.spaces} spaces, {result.summary.tabs} tabs, {result.summary.folders} folders and {result.summary.favorites} favorites. Tabs load when you click them.
        </p>
      )}
      {result?.error && <p className="warn">{result.error}</p>}
      <div className="dialog-foot">
        <span className="grow" />
        <button className="btn" onClick={() => call('closeOverlay')}>
          {result?.summary ? 'Done' : 'Cancel'}
        </button>
        {p && !result?.summary && (
          <button className="btn primary" disabled={busy || s.overlay?.kind !== 'import'} onClick={run}>
            {busy ? 'Importing…' : `Import ${p.spaces.length} spaces`}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- archive ----------

function ArchiveView() {
  const [q, setQ] = useState('')
  const [list, setList] = useState<ArchivedItem[]>([])
  useEffect(() => {
    call<ArchivedItem[]>('listArchive', q).then(setList)
  }, [q])
  return (
    <div className="dialog card archive" role="dialog" aria-label="Archived tabs">
      <h2>
        <Archive size={18} aria-hidden /> Archived tabs
      </h2>
      <p className="fine">Today tabs you have not opened for a while move here. Click one to bring it back.</p>
      <input className="input" autoFocus placeholder="Search archive" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search archive" />
      <ul className="archive-list">
        {list.length === 0 && <li className="fine">{q ? 'No matches.' : 'Nothing archived yet.'}</li>}
        {list.map((a) => (
          <li key={a.id}>
            <button className="row" onClick={() => call('restoreArchived', a.id)}>
              {a.favicon ? <img className="favicon" src={a.favicon} width={16} height={16} alt="" /> : <Globe size={16} aria-hidden />}
              <span className="ellipsis label">{a.title || a.url}</span>
              <span className="fine nowrap">
                {hostOf(a.url)} · {new Date(a.archivedAt).toLocaleDateString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- settings ----------

type Tab = 'general' | 'appearance' | 'shortcuts' | 'adblock' | 'passwords' | 'extensions' | 'boosts' | 'ai' | 'claude' | 'import' | 'about'

/** One entry per section: nav label and icon, and the banner's art and one-line intro. */
const SETTINGS_TABS: { id: Tab; label: string; Icon: typeof Zap; art: string; intro: string }[] = [
  { id: 'general', label: 'General', Icon: SlidersHorizontal, art: artGull, intro: 'Search, tabs, and pages saved for Claude.' },
  { id: 'appearance', label: 'Appearance', Icon: Palette, art: artPainter, intro: 'The app icon, the layout and the colours of your spaces.' },
  { id: 'shortcuts', label: 'Shortcuts', Icon: Keyboard, art: artCompass, intro: 'Every keyboard shortcut, and the keys you would rather use.' },
  { id: 'adblock', label: 'Ad blocking', Icon: ShieldCheck, art: artShield, intro: 'Open filter lists, YouTube included. On from the first launch.' },
  { id: 'ai', label: 'AI', Icon: Sparkles, art: artBottle, intro: 'Off until you switch it on. Pick what runs each feature.' },
  { id: 'claude', label: 'Claude Code', Icon: SquareTerminal, art: artHelm, intro: 'Let your own Claude Code open tabs, read pages, click and type.' },
  { id: 'passwords', label: 'Passwords', Icon: KeyRound, art: artVault, intro: 'Saved with your keychain, filled only on the site they belong to.' },
  { id: 'extensions', label: 'Extensions', Icon: Puzzle, art: artPuzzle, intro: 'Chrome extensions from the Chrome Web Store.' },
  { id: 'boosts', label: 'Boosts', Icon: Zap, art: artPaint, intro: 'Your own colours, fonts and fixes for any site.' },
  { id: 'import', label: 'Import', Icon: Download, art: artBoxes, intro: 'Bring Arc or another browser over. Their files are only read.' },
  { id: 'about', label: 'About', Icon: Info, art: artLighthouse, intro: 'Free software, no account, nothing sent anywhere.' }
]

const APP_ICON_ART: Record<AppIconId, string> = { sunset: iconSunset, day: iconDay, night: iconNight, ink: iconInk, violet: iconViolet }

/** What the settings search can find. Words are matched against the label, the section and the extra terms. */
const SETTINGS_INDEX: [Tab, string, string?][] = [
  ['general', 'Search engine', 'google bing duckduckgo'],
  ['general', 'Archive today tabs after', 'close old tabs'],
  ['general', 'Put idle tabs to sleep after', 'memory sleeping discard'],
  ['general', 'Open links from pinned tabs in Peek', 'peek preview'],
  ['general', 'Pop a playing video out when I switch tabs', 'picture in picture pip video'],
  ['appearance', 'App icon', 'taskbar window logo'],
  ['appearance', 'Tabs layout: top bar or classic sidebar', 'vertical sidebar arc width'],
  ['appearance', 'Space colours, light or dark', 'theme colour color dark mode light mode texture'],
  ['general', 'Pages saved for Claude', 'clips folder save page'],
  ['general', 'Site permissions', 'camera microphone location notifications'],
  ['shortcuts', 'Keyboard shortcuts', 'keys hotkeys ctrl'],
  ['adblock', 'Block ads and trackers', 'adblock ublock ghostery youtube'],
  ['adblock', 'Sites where ads are allowed', 'allowlist whitelist exception'],
  ['ai', 'Use AI features', 'summaries writing tidy tabs'],
  ['ai', 'Default AI engine and per feature', 'model engine'],
  ['ai', 'Local model (Ollama)', 'ollama llama offline'],
  ['ai', 'Anthropic API key', 'claude api key sonnet opus'],
  ['claude', 'Let Claude Code use Solamar', 'mcp agent automation'],
  ['claude', 'How much Claude Code does on its own', 'approvals ask confirm'],
  ['claude', 'Which sites Claude Code may use', 'grants allow block'],
  ['passwords', 'Offer to save passwords', 'logins autofill'],
  ['passwords', 'Saved passwords', 'logins search copy reveal'],
  ['passwords', 'Import passwords from a CSV file', 'bitwarden 1password chrome export'],
  ['extensions', 'Chrome extensions', 'web store add-ons'],
  ['boosts', 'Boosts', 'zap css javascript restyle'],
  ['import', 'Import from Arc', 'spaces pinned folders'],
  ['import', 'Import from Chrome, Edge, Firefox or Safari', 'bookmarks history'],
  ['about', 'Version and licence', 'gpl open source privacy telemetry']
]

/** Short tips the gull at the bottom of the nav gives, one per time Settings opens. */
const GULL_TIPS = [
  'Changes save as you go. Esc closes this window.',
  'Shift+click any link to peek at it without leaving the page.',
  'Ctrl+T opens the command bar: search, sites, tabs and actions.',
  'Right-click a page and pick Save page for Claude to keep a copy for Claude Code.',
  'Boost this site, from the lightning button, makes any site look your way.'
]

function SettingsView({ s }: { s: AppState }) {
  const [tab, setTab] = useState<Tab>((s.overlay?.payload?.tab as Tab) || 'general')
  const [q, setQ] = useState('')
  const [tip] = useState(() => GULL_TIPS[Math.floor(Math.random() * GULL_TIPS.length)])
  const st = s.settings
  const upd = (patch: object) => call('updateSettings', patch)
  const go = (id: Tab) => {
    setTab(id)
    setQ('')
  }
  const current = SETTINGS_TABS.find((t) => t.id === tab) ?? SETTINGS_TABS[0]
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results = words.length
    ? SETTINGS_INDEX.filter(([id, label, extra]) => {
        const hay = `${label} ${extra ?? ''} ${SETTINGS_TABS.find((t) => t.id === id)?.label}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    : []
  return (
    <div className="dialog card settings" role="dialog" aria-label="Settings">
      <nav className="settings-nav">
        <h2>Settings</h2>
        <div className="set-search">
          <Search size={14} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" aria-label="Search settings" spellCheck={false} />
          {q && (
            <button className="icon-btn" aria-label="Clear search" title="Clear" onClick={() => setQ('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="set-tabs" role="tablist" aria-label="Sections">
          {SETTINGS_TABS.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={!words.length && tab === id} className={!words.length && tab === id ? 'on' : ''} onClick={() => go(id)}>
              <Icon size={16} aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div className="set-tip">
          <img src={artGullPeek} alt="" />
          <p>{tip}</p>
        </div>
      </nav>
      <section className="settings-body" role="tabpanel">
        {words.length > 0 ? (
          <>
            <h3 className="settings-h">Results for {q.trim()}</h3>
            {results.length ? (
              <div className="set-group">
                {results.map(([id, label]) => {
                  const t = SETTINGS_TABS.find((x) => x.id === id)!
                  return (
                    <button key={id + label} className="set-row set-result" onClick={() => go(id)}>
                      <t.Icon size={16} aria-hidden />
                      <span className="set-t">
                        <b>{label}</b>
                        <small>{t.label}</small>
                      </span>
                      <ChevronRight size={16} aria-hidden />
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="set-empty">
                <img src={artGullPeek} alt="" />
                <b>No setting called {q.trim()}</b>
                <span>Try another word, or look through the sections on the left.</span>
              </div>
            )}
          </>
        ) : (
          <>
            <header className="set-banner">
              <div>
                <h2>{current.label}</h2>
                <p>{current.intro}</p>
              </div>
              <img src={current.art} alt="" />
            </header>
            {tab === 'general' && (
              <>
                <div className="set-group">
                  <SetRow title="Search engine">
                    <select className="select" value={st.searchEngine} onChange={(e) => upd({ searchEngine: e.target.value })}>
                      {Object.entries(SEARCH_ENGINES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </SetRow>
                </div>
                <h3 className="settings-h">Tabs</h3>
                <div className="set-group">
                  <SetRow title="Archive today tabs after" note="Today's tabs move to the archive when you have not used them for this long.">
                    <select className="select" value={st.archiveAfterHours} onChange={(e) => upd({ archiveAfterHours: Number(e.target.value) })}>
                      {[[12, '12 hours'], [24, '1 day'], [168, '7 days'], [720, '30 days'], [0, 'Never']].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </SetRow>
                  <SetRow title="Put idle tabs to sleep after" note="Sleeping tabs free their memory and reload when you click them. Tabs playing audio never sleep.">
                    <select className="select" value={st.sleepAfterMinutes} onChange={(e) => upd({ sleepAfterMinutes: Number(e.target.value) })}>
                      {[[10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours'], [0, 'Never']].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </SetRow>
                  <SetRow title="Open links from pinned tabs to other sites in Peek" note="Shift+click any link to peek at it. In Peek, Open as tab keeps the page as it is.">
                    <Toggle label="Open links from pinned tabs in Peek" on={st.peekFromPinned} set={(v) => upd({ peekFromPinned: v })} />
                  </SetRow>
                  <SetRow title="Pop a playing video out when I switch tabs" note="The video keeps playing in a small picture in picture window.">
                    <Toggle label="Picture in picture when switching tabs" on={st.autoPip} set={(v) => upd({ autoPip: v })} />
                  </SetRow>
                </div>
                <h3 className="settings-h">Pages saved for Claude</h3>
                <div className="set-group">
                  <SetRow stack title="Folder" note="Right-click a page and pick Save page for Claude: the page, a screenshot, its text and its design go into a folder here, and the path is copied for Claude Code.">
                    <div className="clip-dir">
                      <code className="ellipsis" title={s.clipsRoot}>
                        {s.clipsRoot}
                      </code>
                      <button className="btn small" onClick={() => call('openClipFolder', '')}>
                        Open
                      </button>
                      <button className="btn small" onClick={() => call('chooseClipsDir')}>
                        Change…
                      </button>
                      {st.clipsDir && (
                        <button className="btn link small" onClick={() => call('resetClipsDir')}>
                          Default
                        </button>
                      )}
                    </div>
                  </SetRow>
                </div>
                <SitePermissions s={s} />
              </>
            )}
            {tab === 'appearance' && (
              <>
                <h3 className="settings-h">App icon</h3>
                <div className="icon-grid" role="radiogroup" aria-label="App icon">
                  {APP_ICONS.map(({ id, label }) => (
                    <button key={id} role="radio" aria-checked={st.appIcon === id} className={st.appIcon === id ? 'on' : ''} onClick={() => upd({ appIcon: id })}>
                      <img src={APP_ICON_ART[id]} alt="" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <p className="fine">Changes the window and taskbar icon right away. Shortcuts on the desktop and in the Start menu keep the icon they were made with.</p>
                <h3 className="settings-h">Layout</h3>
                <div className="set-group">
                  <SetRow title="Tabs">
                    <Segmented
                      value={st.layout}
                      options={[
                        ['bar', 'Top bar and tabs'],
                        ['sidebar', 'Classic sidebar']
                      ]}
                      onChange={(v) => upd({ layout: v })}
                    />
                  </SetRow>
                  {st.layout === 'sidebar' && (
                    <SetRow title={`Sidebar width: ${st.sidebarWidth}px`}>
                      <input type="range" min={200} max={420} step={4} value={st.sidebarWidth} onChange={(e) => upd({ sidebarWidth: Number(e.target.value) })} aria-label="Sidebar width" />
                    </SetRow>
                  )}
                </div>
                <h3 className="settings-h">Spaces</h3>
                <div className="set-group">
                  <SetRow title="Colours, light or dark" note="Each space has its own colours and its own light or dark look.">
                    <button className="btn" onClick={() => call('openOverlay', 'theme', { mode: 'edit', spaceId: s.window.focusedSpaceId })}>
                      Edit this space
                    </button>
                  </SetRow>
                </div>
              </>
            )}
            {tab === 'shortcuts' && <Shortcuts s={s} />}
            {tab === 'adblock' && <AdblockSettings s={s} />}
            {tab === 'boosts' && <BoostList s={s} />}
            {tab === 'passwords' && <PasswordSettings s={s} />}
            {tab === 'extensions' && <ExtensionSettings s={s} />}
            {tab === 'ai' && <AiSettings s={s} />}
            {tab === 'claude' && <ClaudeCodeSettings s={s} />}
            {tab === 'import' && (
              <div className="set-group">
                <SetRow title="Arc" note="Spaces, pinned tabs, folders, colours and favorites. Arc's files are only read.">
                  <button className="btn primary" onClick={() => call('openOverlay', 'import')}>
                    Import from Arc
                  </button>
                </SetRow>
                <SetRow title="Another browser" note="Bookmarks and history from Chrome, Edge, Brave, Firefox or Safari.">
                  <button className="btn" onClick={() => call('openOverlay', 'import-browser')}>
                    Choose a browser
                  </button>
                </SetRow>
              </div>
            )}
            {tab === 'about' && (
              <div className="set-about">
                <img src={artGull} alt="" />
                <div>
                  <p>
                    <strong>Solamar</strong> {s.update?.version ?? ''} · no account, no sync server, no telemetry. Free software under the GNU GPL v3 or later.
                  </p>
                  <UpdateRow s={s} />
                  <p className="fine">Your spaces, tabs and settings live in one file in this PC's app data folder. Ad blocking uses open filter lists (EasyList, EasyPrivacy and friends) through Ghostery's open-source engine.</p>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

/** Settings > About: where updates stand, and the buttons that go with it. */
function UpdateRow({ s }: { s: AppState }) {
  const u = s.update
  if (!u) return null
  const text: Record<UpdateState['status'], string> = {
    off: u.offReason === 'personal' ? 'Personal build: it does not update itself. Get new versions by hand.' : 'Updates are off in development builds.',
    idle: 'Checks for updates on its own, every few hours.',
    checking: 'Checking for updates…',
    current: 'You have the latest version.',
    downloading: `Downloading Solamar ${u.next ?? ''}… ${u.progress ?? 0}%`,
    ready: `Solamar ${u.next} is downloaded. It installs when you quit, or now.`,
    manual: `Solamar ${u.next} is out. This Mac build cannot install it itself yet.`,
    error: `Could not check for updates: ${u.error ?? 'unknown error'}`
  }
  return (
    <div className="set-update">
      <p className="fine">{text[u.status]}</p>
      {u.status === 'ready' ? (
        <button className="btn small primary" onClick={() => call('updateInstall')}>
          Restart and update
        </button>
      ) : u.status === 'manual' ? (
        <button className="btn small primary" onClick={() => call('updateOpenRelease')}>
          Get Solamar {u.next}
        </button>
      ) : (
        u.status !== 'off' && (
          <button className="btn small" disabled={u.status === 'checking' || u.status === 'downloading'} onClick={() => call('updateCheck')}>
            Check now
          </button>
        )
      )}
    </div>
  )
}

/** A settings row: what it is (and a line on what it does) on the left, its control on the right, or under it with stack. */
function SetRow({ title, note, stack, children }: { title: string; note?: string; stack?: boolean; children: ReactNode }) {
  return (
    <div className={stack ? 'set-row stack' : 'set-row'}>
      <span className="set-t">
        <b>{title}</b>
        {note && <small>{note}</small>}
      </span>
      <span className="set-c">{children}</span>
    </div>
  )
}

/** An on/off switch; a real checkbox underneath, so keyboard and screen readers treat it as one. */
function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <input type="checkbox" className="toggle" role="switch" aria-label={label} checked={on} onChange={(e) => set(e.target.checked)} />
}

function BoostList({ s }: { s: AppState }) {
  return (
    <>
      <p>Boosts change how a site looks for you: colours, font, hidden elements, your own CSS and JavaScript.</p>
      <p className="fine">Open a site and pick Boost this site from the right-click menu, the lightning button by the address or the command bar.</p>
      <ul className="allow-list boost-list">
        {s.boosts.length === 0 && <li className="fine">No boosts yet.</li>}
        {s.boosts.map((b) => (
          <li key={b.id}>
            <label className="check">
              <input type="checkbox" checked={b.enabled} onChange={(e) => call('updateBoost', b.id, { enabled: e.target.checked })} /> {b.domain}
            </label>
            <span className="fine">{boostSummary(b)}</span>
            <span className="grow" />
            <button className="icon-btn" aria-label={'Delete boost for ' + b.domain} title="Delete" onClick={() => call('deleteBoost', b.id)}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function boostSummary(b: AppState['boosts'][number]): string {
  const parts: string[] = []
  if (b.filter !== 'none' || b.hue) parts.push('colours')
  if (b.font) parts.push('font')
  if (b.zaps.length) parts.push(b.zaps.length + ' zapped')
  if (b.css.trim()) parts.push('CSS')
  if (b.js.trim()) parts.push('JS')
  return parts.join(' · ') || 'empty'
}

function Shortcuts({ s }: { s: AppState }) {
  const [rec, setRec] = useState<CommandId | null>(null)
  useEffect(() => {
    call('suspendShortcuts', !!rec)
    if (!rec) return
    const on = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.code === 'Escape') return setRec(null)
      const acc = accelerator({ key: e.key, code: e.code, control: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey })
      if (!acc || !/\+|^F\d/.test(acc)) return // needs a modifier (or a function key)
      call('updateSettings', { shortcuts: { [rec]: acc } })
      setRec(null)
    }
    window.addEventListener('keydown', on, true)
    return () => {
      window.removeEventListener('keydown', on, true)
      call('suspendShortcuts', false)
    }
  }, [rec])
  const ids = Object.keys(COMMAND_LABELS) as CommandId[]
  const used = new Map<string, number>()
  ids.forEach((id) => used.set(s.settings.shortcuts[id], (used.get(s.settings.shortcuts[id]) ?? 0) + 1))
  return (
    <>
      <p className="fine">Click a shortcut, then press the new keys. Esc cancels. Ctrl+1…9 opens tabs, Alt+1…9 switches spaces.</p>
      <ul className="shortcut-list">
        {ids.map((id) => (
          <li key={id}>
            <span>{COMMAND_LABELS[id]}</span>
            <button className={'kbd-btn' + (rec === id ? ' rec' : '') + ((used.get(s.settings.shortcuts[id]) ?? 0) > 1 ? ' clash' : '')} onClick={() => setRec(rec === id ? null : id)}>
              {rec === id ? 'Press keys…' : s.settings.shortcuts[id] || '—'}
            </button>
            {s.settings.shortcuts[id] !== DEFAULT_SHORTCUTS[id] && (
              <button className="btn link small" onClick={() => call('updateSettings', { shortcuts: { [id]: DEFAULT_SHORTCUTS[id] } })}>
                Reset
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

function AdblockSettings({ s }: { s: AppState }) {
  const st = s.settings.adblock
  const [site, setSite] = useState('')
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={st.enabled} onChange={(e) => call('updateSettings', { adblock: { enabled: e.target.checked } })} /> Block ads and trackers
      </label>
      <p className="fine">{s.adblockReady ? 'Filter lists loaded.' : 'Filter lists are loading (first run downloads them once).'}</p>
      <div className="field">
        <span>Sites where ads are allowed</span>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            const d = site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
            if (d) call('updateSettings', { adblock: { allowlist: [...new Set([...st.allowlist, d])] } })
            setSite('')
          }}
        >
          <input className="input" placeholder="example.com" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site to allow" />
          <button className="btn">Add</button>
        </form>
        <ul className="allow-list">
          {st.allowlist.length === 0 && <li className="fine">None.</li>}
          {st.allowlist.map((d) => (
            <li key={d}>
              <span>{d}</span>
              <button className="btn link small" onClick={() => call('updateSettings', { adblock: { allowlist: st.allowlist.filter((x) => x !== d) } })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
