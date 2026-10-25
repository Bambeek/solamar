// Bar layout (the default): spaces and the address in a top bar, and under it a row of tabs with their titles and a
// close button each, Chrome style. Favorites and pinned tabs sit at the start of the row as icons.
import { useEffect, useRef, useState } from 'react'
import { Folder, PanelTop, Plus, Settings, Sparkles, Volume2, X, Zap } from 'lucide-react'
import type { AppState, Item, Section } from '@shared/types'
import { boostMatches, siteOf } from '@shared/util'
import { DrivingPill } from './AgentUI'
import { call } from './api'
import { ExtensionBar } from './ExtensionsUI'
import { NavButtons, WindowControls } from './Frame'
import { children, DownloadsButton, DRAG, Favicon, label, MiniPlayer, UrlPill } from './Sidebar'
import { SpaceIcon } from './SpaceIcon'
import { startWindowDrag, toggleMaximizeOnDoubleClick } from './windowDrag'
import { keyLabel } from './keys'

export function BarTop({ s }: { s: AppState }) {
  const spaces = [...s.spaces].sort((a, b) => a.position - b.position)
  const compact = spaces.length > 4 // many spaces: names only on the active one
  return (
    <header className="bar-top" onPointerDown={startWindowDrag} onDoubleClick={toggleMaximizeOnDoubleClick}>
      <button
        className={'icon-btn no-drag' + (s.settings.sidebarVisible ? '' : ' on')}
        title={`${s.settings.sidebarVisible ? 'Hide' : 'Show'} tabs (${s.settings.shortcuts.toggleSidebar})`}
        aria-label="Tab row"
        aria-pressed={s.settings.sidebarVisible}
        onClick={() => call('run', 'toggleSidebar')}
      >
        <PanelTop size={16} />
      </button>
      <NavButtons s={s} />
      <nav className="space-pills no-drag" role="tablist" aria-label="Spaces">
        {spaces.map((sp, i) => {
          const on = sp.id === s.window.focusedSpaceId
          return (
            <button
              key={sp.id}
              role="tab"
              aria-selected={on}
              className={'space-pill' + (on ? ' on' : '')}
              title={`${sp.title} (Alt+${i + 1})`}
              onClick={() => call('switchSpace', sp.id)}
              onContextMenu={(e) => (e.preventDefault(), call('spaceMenu', sp.id))}
            >
              <SpaceIcon id={sp.icon} size={13} />
              {(!compact || on) && <span className="ellipsis">{sp.title}</span>}
            </button>
          )
        })}
        <button className="space-pill add" title="New space" aria-label="New space" onClick={() => call('openOverlay', 'space-new', { mode: 'new' })}>
          <Plus size={14} />
        </button>
      </nav>
      <div className="bar-url">
        <UrlPill s={s} noBoost />
      </div>
      <DrivingPill s={s} />
      <ExtensionBar s={s} />
      <MiniPlayer s={s} compact />
      <span className="bar-tools no-drag">
        <DownloadsButton s={s} />
        <BoostButton s={s} />
        <button
          className={'icon-btn' + (s.ai.panelOpen ? ' on' : '')}
          title={`AI (${s.settings.shortcuts.aiPanel})`}
          aria-label="AI"
          aria-pressed={s.ai.panelOpen}
          onClick={() => call('run', 'aiPanel')}
        >
          <Sparkles size={16} />
        </button>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => call('run', 'settings')}>
          <Settings size={16} />
        </button>
      </span>
      <WindowControls s={s} />
    </header>
  )
}

/** Boost for the open site: lit when the site has one, pressed while the editor is open. */
function BoostButton({ s }: { s: AppState }) {
  const url = s.items.find((i) => i.id === s.activeId)?.url ?? ''
  const site = siteOf(url)
  const web = /^https?:/.test(url)
  const boosted = web && s.boosts.some((b) => b.enabled && boostMatches(b.domain, site))
  const open = !!s.boostEditor
  return (
    <button
      className={'icon-btn boost-top' + (boosted ? ' boosted' : '') + (open ? ' on' : '')}
      title={!web ? 'Boost: open a website first' : boosted ? `Edit the boost for ${site}` : `Boost ${site}: colours, font, zap, CSS`}
      aria-label="Boost this site"
      aria-pressed={open}
      disabled={!web && !open}
      onClick={() => call(open ? 'closeBoost' : 'openBoost')}
    >
      <Zap size={16} />
    </button>
  )
}

/** Tabs of a section in sidebar order, folders opened up (the icon area has no room for folders). */
function flat(s: AppState, section: Section, parent: string | null = null): Item[] {
  return children(s, section, parent).flatMap((it) => (it.kind === 'tab' ? [it] : flat(s, section, it.id)))
}

/** Index for moveItem (which counts the list without the moved item) when dropping next to `target`. */
function dropIndex(list: Item[], dragged: string, target: string, side: 'before' | 'after'): number {
  const rest = list.filter((i) => i.id !== dragged)
  const at = rest.findIndex((i) => i.id === target)
  return at < 0 ? rest.length : at + (side === 'after' ? 1 : 0)
}

const hasDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG)

export function TabRow({ s, hidden }: { s: AppState; hidden: boolean }) {
  const favorites = children(s, 'favorites', null).filter((i) => i.kind === 'tab')
  const pinned = flat(s, 'pinned')
  const today = children(s, 'today', null)
  const scroller = useRef<HTMLDivElement>(null)
  const [pinDrop, setPinDrop] = useState(false)
  const [dragging, setDragging] = useState(false) // shows the pin area as a drop target even when nothing is pinned
  useEffect(() => {
    // Braces matter: scrollIntoView may return a Promise, which React would treat as a cleanup.
    scroller.current?.querySelector('.htab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [s.activeId, today.length])

  return (
    <div
      className={'tab-row' + (hidden ? ' is-hidden' : '')}
      inert={hidden}
      aria-label="Tabs"
      onDragStartCapture={() => setDragging(true)}
      onDragEndCapture={() => (setDragging(false), setPinDrop(false))}
      onDropCapture={() => setDragging(false)}
    >
      {(favorites.length > 0 || pinned.length > 0 || dragging) && (
        <div
          className={'pin-icons' + (pinDrop ? ' drop' : '')}
          title="Drop a tab here to pin it"
          onDragOver={(e) => hasDrag(e) && (e.preventDefault(), setPinDrop(true))}
          onDragLeave={() => setPinDrop(false)}
          onDrop={(e) => {
            setPinDrop(false)
            const id = e.dataTransfer.getData(DRAG)
            if (id) call('moveItem', id, { section: 'pinned', parentId: null, index: 999 })
          }}
        >
          {favorites.map((t) => (
            <PinIcon key={t.id} s={s} item={t} />
          ))}
          {favorites.length > 0 && pinned.length > 0 && <span className="pin-sep" aria-hidden />}
          {pinned.map((t) => (
            <PinIcon key={t.id} s={s} item={t} />
          ))}
        </div>
      )}
      <div
        className="htabs"
        role="tablist"
        aria-label="Open tabs"
        ref={scroller}
        onWheel={(e) => {
          // A plain mouse wheel scrolls the row sideways when there are more tabs than room.
          if (scroller.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) scroller.current.scrollLeft += e.deltaY
        }}
        onDragOver={(e) => hasDrag(e) && e.preventDefault()}
        onDrop={(e) => {
          // Dropped on the empty end of the row: last today tab (also unpins a pinned one).
          if (e.defaultPrevented) return
          const id = e.dataTransfer.getData(DRAG)
          if (id) call('moveItem', id, { section: 'today', parentId: null, index: 999 })
        }}
      >
        {today.map((it) =>
          it.kind === 'folder' ? (
            <TabGroup key={it.id} s={s} folder={it} />
          ) : (
            <HTab key={it.id} s={s} item={it} siblings={today} parentId={null} />
          )
        )}
        <button className="htab-new" title={`New tab (${s.settings.shortcuts.newTab})`} aria-label="New tab" onClick={() => call('run', 'newTab')}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

/** A favorite or pinned tab as an icon; drop another tab on its left or right half to place it there. */
function PinIcon({ s, item }: { s: AppState; item: Item }) {
  const [hint, setHint] = useState<'before' | 'after' | null>(null)
  const active = s.activeId === item.id
  const rt = s.runtime[item.id]
  const side = (e: React.DragEvent): 'before' | 'after' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after'
  }
  return (
    <button
      className={['pin-icon', active && 'active', rt?.awake && 'awake', hint && 'drop-' + hint].filter(Boolean).join(' ')}
      title={`${label(item)}\n${item.url ?? ''}`}
      aria-label={label(item)}
      aria-current={active ? 'page' : undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG, item.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!hasDrag(e)) return
        e.preventDefault()
        e.stopPropagation()
        setHint(side(e))
      }}
      onDragLeave={() => setHint(null)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation() // the icon area would otherwise put it at the end
        const where = side(e)
        setHint(null)
        const id = e.dataTransfer.getData(DRAG)
        if (!id || id === item.id) return
        // Same list as the target: favorites, or the pinned folder (or top level) the target sits in.
        const siblings = children(s, item.section, item.parentId)
        call('moveItem', id, { section: item.section, parentId: item.parentId, index: dropIndex(siblings, id, item.id, where) })
      }}
      onClick={() => call('activate', item.id)}
      onAuxClick={(e) => e.button === 1 && call('closeTab', item.id)}
      onContextMenu={(e) => (e.preventDefault(), call('itemMenu', item.id))}
    >
      <Favicon item={item} size={16} />
      {rt?.audible && <span className="pin-audible" aria-label="Playing audio" />}
    </button>
  )
}

function HTab({ s, item, siblings, parentId }: { s: AppState; item: Item; siblings: Item[]; parentId: string | null }) {
  const [hint, setHint] = useState<'before' | 'after' | null>(null)
  const active = s.activeId === item.id
  const rt = s.runtime[item.id]
  const side = (e: React.DragEvent): 'before' | 'after' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after'
  }
  const open = () => call('activate', item.id)
  return (
    <div
      className={['htab', active && 'active', rt?.awake && 'awake', hint && 'drop-' + hint].filter(Boolean).join(' ')}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={`${label(item)}\n${item.url ?? ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG, item.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!hasDrag(e)) return
        e.preventDefault()
        setHint(side(e))
      }}
      onDragLeave={() => setHint(null)}
      onDrop={(e) => {
        e.preventDefault()
        const where = side(e)
        setHint(null)
        const id = e.dataTransfer.getData(DRAG)
        if (id && id !== item.id) call('moveItem', id, { section: 'today', parentId, index: dropIndex(siblings, id, item.id, where) })
      }}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
      onAuxClick={(e) => e.button === 1 && call('closeTab', item.id)}
      onContextMenu={(e) => (e.preventDefault(), call('itemMenu', item.id))}
    >
      <Favicon item={item} size={16} />
      <span className="htab-title ellipsis">{label(item)}</span>
      {rt?.audible && <Volume2 size={13} className="htab-sound" aria-label="Playing audio" />}
      <button
        className="htab-close"
        aria-label={'Close ' + label(item)}
        title={`Close tab (${keyLabel('Ctrl+W')})`}
        onClick={(e) => (e.stopPropagation(), call('closeTab', item.id))}
        onAuxClick={(e) => e.stopPropagation()}
      >
        <X size={13} />
      </button>
    </div>
  )
}

/** A folder among today's tabs reads as a group: a coloured name chip, then its tabs (unless folded). */
function TabGroup({ s, folder }: { s: AppState; folder: Item }) {
  const kids = children(s, 'today', folder.id)
  const name = folder.customTitle || folder.title || 'Group'
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  const tabs = kids.filter((k) => k.kind === 'tab')
  return (
    <div className={'htab-group' + (folder.collapsed ? ' folded' : '')} style={{ '--group': `hsl(${h} 55% 55%)` } as React.CSSProperties}>
      <button
        className="group-chip"
        title={folder.collapsed ? `Show ${tabs.length} tabs` : 'Fold this group'}
        draggable
        onDragStart={(e) => e.dataTransfer.setData(DRAG, folder.id)}
        onDragOver={(e) => hasDrag(e) && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const id = e.dataTransfer.getData(DRAG)
          if (id && id !== folder.id) call('moveItem', id, { section: 'today', parentId: folder.id, index: 999 })
        }}
        onClick={() => call('toggleFolder', folder.id)}
        onContextMenu={(e) => (e.preventDefault(), call('itemMenu', folder.id))}
        aria-expanded={!folder.collapsed}
      >
        <Folder size={13} aria-hidden />
        <span className="ellipsis">{name}</span>
        {folder.collapsed && <span className="group-count">{tabs.length}</span>}
      </button>
      {!folder.collapsed && tabs.map((t) => <HTab key={t.id} s={s} item={t} siblings={kids} parentId={folder.id} />)}
    </div>
  )
}
