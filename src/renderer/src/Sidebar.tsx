import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ChevronRight,
  Download,
  Folder,
  FolderOpen,
  Globe,
  Pin,
  MoreHorizontal,
  Pause,
  PictureInPicture2,
  Play,
  VolumeX,
  Zap,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldOff,
  Sparkles,
  Volume2,
  X
} from 'lucide-react'
import type { AppState, Item, Section } from '@shared/types'
import { boostMatches, hostOf, siteOf } from '@shared/util'
import { call } from './api'
import { DrivingPill } from './AgentUI'
import { ExtensionBar } from './ExtensionsUI'
import { NavButtons, WindowControls } from './Frame'
import { SpaceIcon } from './SpaceIcon'
import { startWindowDrag, toggleMaximizeOnDoubleClick } from './windowDrag'
import { keyLabel } from './keys'

export const DRAG = 'application/x-solamar-item'
let resizeFrame = 0
type Drop = { section: Section; parentId: string | null; index: number }

export function children(s: AppState, section: Section, parentId: string | null): Item[] {
  return s.items
    .filter((i) => i.section === section && i.parentId === parentId && (section === 'favorites' || i.spaceId === s.window.focusedSpaceId))
    .sort((a, b) => a.position - b.position)
}

export const label = (i: Item) => i.customTitle || i.title || hostOf(i.url) || 'New tab'

// Tabs that were never loaded here (e.g. imported from Arc) fall back to the site's own /favicon.ico.
function faviconSrc(item: Item): string | undefined {
  if (item.favicon) return item.favicon
  try {
    const u = new URL(item.url ?? '')
    return /^https?:$/.test(u.protocol) ? u.origin + '/favicon.ico' : undefined
  } catch {
    return undefined
  }
}

// No icon available: the site's first letter on a colour derived from its name (no third-party icon service).
function LetterIcon({ url, size }: { url?: string; size: number }) {
  const site = hostOf(url).replace(/^(m|mail|app|web)\./, '')
  let h = 0
  for (const c of site) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span className="favicon letter-icon" style={{ width: size, height: size, fontSize: Math.round(size * 0.62), background: `hsl(${h} 45% 46%)` }} aria-hidden>
      {(site[0] ?? '?').toUpperCase()}
    </span>
  )
}

export function Favicon({ item, size = 16 }: { item: Item; size?: number }) {
  const src = faviconSrc(item)
  const [broken, setBroken] = useState<string | null>(null)
  if (src && broken !== src) return <img className="favicon" src={src} width={size} height={size} alt="" onError={() => setBroken(src)} />
  return item.url ? <LetterIcon url={item.url} size={size} /> : <Globe className="favicon" size={size} aria-hidden />
}

export function Sidebar({ s, hidden = false }: { s: AppState; hidden?: boolean }) {
  const space = s.spaces.find((x) => x.id === s.window.focusedSpaceId)!
  const favorites = children(s, 'favorites', null)
  const pinned = children(s, 'pinned', null)
  const today = children(s, 'today', null)
  const [drop, setDrop] = useState<string | null>(null)
  const ordered = [...s.spaces].sort((a, b) => a.position - b.position)
  const spaceIndex = ordered.findIndex((x) => x.id === space.id)
  const lastIndex = useRef(spaceIndex)
  const enterFrom = spaceIndex === lastIndex.current ? '' : spaceIndex > lastIndex.current ? ' enter-right' : ' enter-left'
  useEffect(() => {
    lastIndex.current = spaceIndex
  }, [spaceIndex])

  const clearToday = () => today.forEach((t) => (t.kind === 'tab' ? call('closeTab', t.id) : undefined))

  return (
    <aside className={'sidebar' + (hidden ? ' is-hidden' : '')} style={{ width: s.settings.sidebarWidth }} aria-label="Sidebar" inert={hidden}>
      <div
        className="sidebar-resizer no-drag"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={s.settings.sidebarWidth}
        aria-valuemin={200}
        aria-valuemax={420}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          // Two paths: pointer capture here, and a full-window overlay for when the mouse is over a web page view.
          e.currentTarget.setPointerCapture(e.pointerId)
          call('openOverlay', 'resize')
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          const x = e.clientX
          if (!resizeFrame) resizeFrame = requestAnimationFrame(() => ((resizeFrame = 0), call('setSidebarWidth', x)))
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          call('closeOverlay')
        }}
        onDoubleClick={() => call('setSidebarWidth', 264)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            call('setSidebarWidth', s.settings.sidebarWidth + (e.key === 'ArrowLeft' ? -16 : 16))
          }
        }}
      />
      <div className="sidebar-top" onPointerDown={startWindowDrag} onDoubleClick={toggleMaximizeOnDoubleClick}>
        <button className="icon-btn" title={`Hide sidebar (${s.settings.shortcuts.toggleSidebar})`} aria-label="Hide sidebar" onClick={() => call('run', 'toggleSidebar')}>
          <PanelLeftClose size={15} />
        </button>
        <NavButtons s={s} />
        <span className="grow" />
        <WindowControls s={s} />
      </div>

      <UrlPill s={s} />
      <ExtensionBar s={s} />

      {(favorites.length > 0 || drop === 'fav') && (
        <div
          className={'favorites' + (drop === 'fav' ? ' drop-target' : '')}
          onDragOver={(e) => accept(e, () => setDrop('fav'))}
          onDragLeave={() => setDrop(null)}
          onDrop={(e) => doDrop(e, { section: 'favorites', parentId: null, index: favorites.length }, () => setDrop(null))}
        >
          {favorites.map((f) => (
            <button
              key={f.id}
              className={'fav' + (s.activeId === f.id ? ' active' : '')}
              title={label(f)}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DRAG, f.id)}
              onClick={() => call('activate', f.id)}
              onContextMenu={(e) => (e.preventDefault(), call('itemMenu', f.id))}
            >
              <Favicon item={f} size={16} />
            </button>
          ))}
        </div>
      )}

      <div className={'space-head space-anim' + enterFrom} key={'head-' + space.id}>
        <button className="space-title" onClick={() => call('openOverlay', 'theme', { mode: 'edit', spaceId: space.id })} title="Edit space theme">
          <SpaceIcon id={space.icon} size={13} className="space-icon" />
          <span className="ellipsis">{space.title}</span>
        </button>
        <button className="icon-btn" aria-label="Space options" title="Space options" onClick={() => call('spaceMenu', space.id)}>
          <MoreHorizontal size={15} />
        </button>
      </div>

      {space.private && <p className="private-note">Nothing here is saved. Closing Solamar or this space forgets it.</p>}
      <div className={'tabs-scroll space-anim' + enterFrom} key={'tabs-' + space.id}>
        <ItemList s={s} section="pinned" parentId={null} items={pinned} depth={0} />
        {pinned.length === 0 && <DropZone section="pinned" index={0} text="No pinned tabs" />}

        <div className="today-head">
          <button className="row new-tab" onClick={() => call('run', 'newTab')} title={`New tab (${s.settings.shortcuts.newTab})`}>
            <Plus size={15} />
            <span>New tab</span>
          </button>
          {today.length > 0 && (
            <button className="clear" onClick={clearToday} title="Close all today tabs">
              Clear
            </button>
          )}
        </div>
        <ItemList s={s} section="today" parentId={null} items={today} depth={0} />
        <DropZone section="today" index={today.length} text="" />
      </div>

      <MiniPlayer s={s} />
      <DrivingPill s={s} />
      <footer className="sidebar-foot">
        <DownloadsButton s={s} />
        <button className="icon-btn" title={`Archived tabs (${s.archiveCount})`} aria-label="Archived tabs" onClick={() => call('run', 'archive')}>
          <Archive size={16} />
        </button>
        <div className="space-dots" role="tablist" aria-label="Spaces">
          {[...s.spaces]
            .sort((a, b) => a.position - b.position)
            .map((sp, i) => (
              <button
                key={sp.id}
                role="tab"
                aria-selected={sp.id === space.id}
                className={'space-dot' + (sp.id === space.id ? ' active' : '')}
                title={`${sp.title} (Alt+${i + 1})`}
                onClick={() => call('switchSpace', sp.id)}
                onContextMenu={(e) => (e.preventDefault(), call('spaceMenu', sp.id))}
              >
                <SpaceIcon id={sp.icon} size={15} />
              </button>
            ))}
          <button className="space-dot add" title="New space" aria-label="New space" onClick={() => call('openOverlay', 'space-new', { mode: 'new' })}>
            <Plus size={14} />
          </button>
        </div>
        <button
          className={'icon-btn' + (s.ai.panelOpen ? ' on' : '')}
          title={`Local AI (${s.settings.shortcuts.aiPanel})`}
          aria-label="Local AI"
          aria-pressed={s.ai.panelOpen}
          onClick={() => call('run', 'aiPanel')}
        >
          <Sparkles size={16} />
        </button>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => call('run', 'settings')}>
          <Settings size={16} />
        </button>
      </footer>
    </aside>
  )
}

function accept(e: React.DragEvent, then?: () => void) {
  if (!e.dataTransfer.types.includes(DRAG)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  then?.()
}

function doDrop(e: React.DragEvent, to: Drop, done?: () => void) {
  const id = e.dataTransfer.getData(DRAG)
  done?.()
  if (!id) return
  e.preventDefault()
  e.stopPropagation()
  call('moveItem', id, to)
}

function DropZone({ section, index, text }: { section: Section; index: number; text: string }) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={'drop-zone' + (over ? ' over' : '') + (text ? ' labelled' : '')}
      onDragOver={(e) => accept(e, () => setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => doDrop(e, { section, parentId: null, index }, () => setOver(false))}
    >
      {text && (
        <>
          <Pin size={14} aria-hidden />
          <span>{text}</span>
        </>
      )}
    </div>
  )
}

function ItemList({ s, section, parentId, items, depth }: { s: AppState; section: Section; parentId: string | null; items: Item[]; depth: number }) {
  return (
    <ul className="item-list" role="list">
      {items.map((it, i) => (
        <Row key={it.id} s={s} item={it} index={i} section={section} parentId={parentId} depth={depth} />
      ))}
    </ul>
  )
}

function Row({ s, item, index, section, parentId, depth }: { s: AppState; item: Item; index: number; section: Section; parentId: string | null; depth: number }) {
  const [hint, setHint] = useState<'before' | 'after' | 'inside' | null>(null)
  const rt = s.runtime[item.id]
  const active = s.activeId === item.id
  const inSplit = s.window.split.includes(item.id) && s.window.split.includes(s.activeId ?? '')
  const isFolder = item.kind === 'folder'

  const where = (e: React.DragEvent): 'before' | 'after' | 'inside' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    if (isFolder && y > 0.28 && y < 0.72) return 'inside'
    return y < 0.5 ? 'before' : 'after'
  }

  const onDrop = (e: React.DragEvent) => {
    const w = where(e)
    setHint(null)
    if (w === 'inside') return doDrop(e, { section, parentId: item.id, index: 0 })
    doDrop(e, { section, parentId, index: w === 'before' ? index : index + 1 })
  }

  return (
    <li>
      <div
        className={['row', 'item', active && 'active', inSplit && 'split', rt?.awake && 'awake', hint && 'drop-' + hint].filter(Boolean).join(' ')}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        role="button"
        tabIndex={0}
        aria-current={active ? 'page' : undefined}
        title={item.kind === 'tab' ? `${label(item)}\n${item.url ?? ''}` : label(item)}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG, item.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => accept(e, () => setHint(where(e)))}
        onDragLeave={() => setHint(null)}
        onDrop={onDrop}
        onClick={() => call('activate', item.id)}
        onDoubleClick={() => call('openOverlay', 'command', { mode: 'edit', tab: item.id, text: label(item) })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            call('activate', item.id)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          call('itemMenu', item.id)
        }}
        onAuxClick={(e) => e.button === 1 && item.kind === 'tab' && call('closeTab', item.id)}
      >
        {isFolder ? (
          <>
            <ChevronRight size={14} className={'chev' + (item.collapsed ? '' : ' open')} aria-hidden />
            {item.collapsed ? <Folder size={16} aria-hidden /> : <FolderOpen size={16} aria-hidden />}
          </>
        ) : (
          <Favicon item={item} />
        )}
        <span className="ellipsis label">{label(item)}</span>
        {rt?.audible && <Volume2 size={14} className="audible" aria-label="Playing audio" />}
        {item.kind === 'tab' && (
          <button
            className="row-close"
            aria-label={section === 'today' ? 'Close tab' : 'Unload tab'}
            title={section === 'today' ? `Close (${keyLabel('Ctrl+W')})` : 'Unload'}
            onClick={(e) => {
              e.stopPropagation()
              call('closeTab', item.id)
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {isFolder && !item.collapsed && (
        <ItemList s={s} section={section} parentId={item.id} items={children(s, section, item.id)} depth={depth + 1} />
      )}
    </li>
  )
}

export function DownloadsButton({ s }: { s: AppState }) {
  const active = s.downloads.filter((d) => d.state === 'progressing')
  if (!s.downloads.length) return null
  const total = active.reduce((n, d) => n + (d.total || 0), 0)
  const got = active.reduce((n, d) => n + d.received, 0)
  const pct = active.length && total ? got / total : 0
  return (
    <button
      className={'icon-btn dl-btn' + (active.length ? ' busy' : '')}
      title={active.length ? `${active.length} downloading` : 'Downloads'}
      aria-label="Downloads"
      onClick={() => call('run', 'downloads')}
      style={active.length ? ({ '--pct': `${Math.round(pct * 360)}deg` } as React.CSSProperties) : undefined}
    >
      <Download size={16} />
    </button>
  )
}

/** Media playing in a tab you are not looking at: title, play/pause, picture in picture, stop. */
export function MiniPlayer({ s, compact = false }: { s: AppState; compact?: boolean }) {
  const m = s.media
  const it = m && s.items.find((i) => i.id === m.id)
  if (!m || !it) return null
  const toggle = (
    <button className="icon-btn" aria-label={m.playing ? 'Pause' : 'Play'} title={m.playing ? 'Pause' : 'Play'} onClick={() => call('mediaAction', 'toggle')}>
      {m.playing ? <Pause size={15} /> : <Play size={15} />}
    </button>
  )
  if (compact)
    return (
      <div className="mini-player compact no-drag" role="group" aria-label="Now playing">
        {toggle}
        <button className="mini-main" onClick={() => call('activate', m.id)} title={'Go to ' + m.site}>
          <span className="ellipsis mini-title">{m.title}</span>
        </button>
        {m.video && (
          <button className="icon-btn" aria-label="Picture in picture" title="Picture in picture" onClick={() => call('mediaAction', 'pip')}>
            <PictureInPicture2 size={14} />
          </button>
        )}
        <button className="icon-btn" aria-label="Stop and close player" title="Stop" onClick={() => call('mediaAction', 'close')}>
          <X size={14} />
        </button>
      </div>
    )
  return (
    <div className={'mini-player' + (m.playing ? ' playing' : '')} role="group" aria-label="Now playing">
      <button className="mini-main" onClick={() => call('activate', m.id)} title={'Go to ' + m.site}>
        <Favicon item={it} size={16} />
        <span className="mini-text">
          <span className="ellipsis mini-title">{m.title}</span>
          <span className="ellipsis fine">{m.artist || m.site}</span>
        </span>
      </button>
      <span className="mini-controls">
        {toggle}
        {m.video && (
          <button className="icon-btn" aria-label="Picture in picture" title="Picture in picture" onClick={() => call('mediaAction', 'pip')}>
            <PictureInPicture2 size={15} />
          </button>
        )}
        {m.muted && (
          <button className="icon-btn" aria-label="Unmute" title="Unmute" onClick={() => call('mediaAction', 'mute')}>
            <VolumeX size={15} />
          </button>
        )}
        <button className="icon-btn" aria-label="Stop and close player" title="Stop" onClick={() => call('mediaAction', 'close')}>
          <X size={15} />
        </button>
      </span>
    </div>
  )
}

/** noBoost: the bar layout has its own Boost button in the top bar. */
export function UrlPill({ s, noBoost = false }: { s: AppState; noBoost?: boolean }) {
  const it = s.items.find((i) => i.id === s.activeId)
  const rt = s.activeId ? s.runtime[s.activeId] : undefined
  const site = siteOf(it?.url)
  const allowed = site && s.settings.adblock.allowlist.includes(site)
  const secure = it?.url?.startsWith('https://')
  const shieldOn = s.settings.adblock.enabled && !allowed
  const boosted = !!site && s.boosts.some((b) => b.enabled && boostMatches(b.domain, site))
  const web = /^https?:/.test(it?.url ?? '')
  return (
    <div className="url-pill no-drag">
      <button className="url-text" onClick={() => call('run', 'focusUrl')} title={`Edit address (${keyLabel('Ctrl+L')})`}>
        {it && !secure ? <Globe size={13} aria-label="Not secure" /> : <Search size={13} aria-hidden />}
        <span className="ellipsis">{it ? hostOf(it.url) || it.url : 'Search or enter address'}</span>
      </button>
      {it && (
        <>
          {site && (
            <button
              className={'shield' + (shieldOn ? ' on' : '')}
              title={
                !s.settings.adblock.enabled
                  ? 'Ad blocking is off (Settings)'
                  : allowed
                    ? `Ads allowed on ${site}. Click to block again.`
                    : s.adblockReady
                      ? `${rt?.blocked ?? 0} ads and trackers blocked. Click to allow ads on ${site}.`
                      : 'Loading ad block lists…'
              }
              aria-label="Ad blocking for this site"
              onClick={() => s.settings.adblock.enabled && call('allowSite', site)}
            >
              {shieldOn ? <Shield size={13} /> : <ShieldOff size={13} />}
              {shieldOn && (rt?.blocked ?? 0) > 0 && <span className="count">{rt!.blocked > 99 ? '99+' : rt!.blocked}</span>}
            </button>
          )}
          {web && !noBoost && (
            <button
              className={'shield boost-btn' + (boosted ? ' on' : '') + (s.boostEditor ? ' open' : '')}
              title={boosted ? 'Boosted. Edit the boost for ' + site : 'Boost ' + site + ': colours, font, zap, code'}
              aria-label="Boost this site"
              aria-pressed={!!s.boostEditor}
              onClick={() => call(s.boostEditor ? 'closeBoost' : 'openBoost')}
            >
              <Zap size={13} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
