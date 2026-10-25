// The window frame (renderer #ui): background, sidebar or top bar, empty state, AI panel.
// Web pages are separate views that the main process lays over the content area.
import { Component, useEffect } from 'react'
import { ArrowLeft, ArrowRight, Copy, Minus, PanelLeft, RotateCw, Square, X } from 'lucide-react'
import type { AppState } from '@shared/types'
import { call, useAppState, useSystemDark } from './api'
import { AiPanel } from './AiPanel'
import { BarTop, TabRow } from './BarLayout'
import { BoostPanel } from './BoostPanel'
import { ExtensionBar } from './ExtensionsUI'
import { MiniPlayer, Sidebar, UrlPill } from './Sidebar'
import { SpaceIcon } from './SpaceIcon'
import { applyTheme } from './theme'
import { startWindowDrag, toggleMaximizeOnDoubleClick } from './windowDrag'
import { keyLabel } from './keys'

export function Frame() {
  const s = useAppState()
  const dark = useSystemDark()
  const space = s?.spaces.find((x) => x.id === s.window.focusedSpaceId)
  useEffect(() => {
    applyTheme(document.documentElement, space, dark, s?.settings.layout)
  }, [space, dark, s?.settings.layout])
  if (!s) return null
  const bar = s.settings.layout === 'bar'
  return (
    <div className={'frame platform-' + s.platform + (s.settings.sidebarVisible ? '' : ' no-sidebar') + (bar ? ' bar-layout' : '')}>
      {bar ? (
        <Guard name="top bar">
          <BarTop s={s} />
          <TabRow s={s} hidden={!s.settings.sidebarVisible} />
        </Guard>
      ) : (
        // Both stay mounted so hiding and showing can slide instead of jumping.
        <Guard name="sidebar">
          <Sidebar s={s} hidden={!s.settings.sidebarVisible} />
          <TopBar s={s} hidden={s.settings.sidebarVisible} />
        </Guard>
      )}
      {!bar && s.settings.sidebarVisible && (
        <div
          className="drag-strip"
          style={{ left: s.settings.sidebarWidth, right: 8 + (sidePanel(s) ? 380 : 0) }}
          onPointerDown={startWindowDrag}
          onDoubleClick={toggleMaximizeOnDoubleClick}
          aria-hidden
        />
      )}
      <main className={'content-slot' + (s.agent.active && !s.agent.paused ? ' ai-driving' : '')} style={contentStyle(s)}>
        {!s.activeId && <Empty s={s} />}
        {s.layoutSnapshot?.map((p, i) => (
          <img key={i} className="page-snapshot" src={p.src} alt="" style={{ left: p.x, top: p.y, width: p.width, height: p.height }} />
        ))}
      </main>
      {s.ai.panelOpen && (
        <Guard name="AI panel">
          <AiPanel s={s} />
        </Guard>
      )}
      {s.boostEditor && !s.ai.panelOpen && (
        <Guard name="boost editor">
          <BoostPanel s={s} />
        </Guard>
      )}
    </div>
  )
}

/** Keeps one broken part from blanking the whole window frame. */
export class Guard extends Component<{ name: string; children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message }
  }
  componentDidCatch(e: Error) {
    console.error(`[${this.props.name}]`, e)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="guard" role="alert">
        <p>The {this.props.name} hit an error.</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Retry
        </button>
      </div>
    )
  }
}

function contentStyle(s: AppState): React.CSSProperties {
  const bar = s.settings.layout === 'bar' // keep in step with contentRect() in browser.ts
  return {
    left: bar ? 8 : s.settings.sidebarVisible ? s.settings.sidebarWidth : 8,
    top: bar ? 46 + (s.settings.sidebarVisible ? 38 : 0) : s.settings.sidebarVisible ? 8 : 40,
    right: 8 + (sidePanel(s) ? 380 : 0)
  }
}

/** The AI panel or the boost editor takes the strip right of the page. */
const sidePanel = (s: AppState) => s.ai.panelOpen || !!s.boostEditor

/** The app icon (build/icon.svg, Classic in Settings > Appearance): a sun over water. */
export function AppMark({ size }: { size: number }) {
  return (
    <svg className="app-mark" width={size} height={size} viewBox="0 0 256 256" aria-hidden>
      <rect width="256" height="256" rx="58" fill="#f2eeff" />
      <circle cx="128" cy="128" r="76" fill="#7c6cf2" />
      <path d="M52 150c22-14 44-14 66 0s44 14 66 0 44-14 20 0" fill="none" stroke="#f2eeff" strokeWidth="16" strokeLinecap="round" />
      <path d="M60 182c22-14 44-14 66 0s44 14 66 0" fill="none" stroke="#f2eeff" strokeWidth="16" strokeLinecap="round" opacity=".7" />
    </svg>
  )
}

export function NavButtons({ s }: { s: AppState }) {
  const rt = s.activeId ? s.runtime[s.activeId] : undefined
  return (
    <div className="nav-buttons no-drag">
      <button className="icon-btn" title="Back (Alt+Left)" aria-label="Back" disabled={!rt?.canGoBack} onClick={() => call('nav', 'back')}>
        <ArrowLeft size={16} />
      </button>
      <button className="icon-btn" title="Forward (Alt+Right)" aria-label="Forward" disabled={!rt?.canGoForward} onClick={() => call('nav', 'forward')}>
        <ArrowRight size={16} />
      </button>
      <button className="icon-btn" title={rt?.loading ? 'Stop' : `Reload (${keyLabel('Ctrl+R')})`} aria-label="Reload" disabled={!rt} onClick={() => call('nav', rt?.loading ? 'stop' : 'reload')}>
        {rt?.loading ? <X size={16} /> : <RotateCw size={15} />}
      </button>
    </div>
  )
}

export function WindowControls({ s }: { s: AppState }) {
  if (s.platform === 'darwin') return null
  return (
    <div className="window-controls no-drag">
      <button className="wc-btn" aria-label="Minimize" onClick={() => call('windowControl', 'minimize')}>
        <Minus size={15} />
      </button>
      <button className="wc-btn" aria-label={s.maximized ? 'Restore' : 'Maximize'} onClick={() => call('windowControl', 'maximize')}>
        {s.maximized ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button className="wc-btn close" aria-label="Close" onClick={() => call('windowControl', 'close')}>
        <X size={16} />
      </button>
    </div>
  )
}

function TopBar({ s, hidden }: { s: AppState; hidden: boolean }) {
  return (
    <header className={'topbar' + (hidden ? ' is-hidden' : '')} inert={hidden} onPointerDown={startWindowDrag} onDoubleClick={toggleMaximizeOnDoubleClick}>
      <button className="icon-btn no-drag" title={`Show sidebar (${keyLabel('Ctrl+S')})`} aria-label="Show sidebar" onClick={() => call('run', 'toggleSidebar')}>
        <PanelLeft size={16} />
      </button>
      <NavButtons s={s} />
      <div className="topbar-url">
        <UrlPill s={s} />
      </div>
      <ExtensionBar s={s} />
      <MiniPlayer s={s} compact />
      <WindowControls s={s} />
    </header>
  )
}

function Empty({ s }: { s: AppState }) {
  const space = s.spaces.find((x) => x.id === s.window.focusedSpaceId)
  return (
    <div className="empty">
      {!s.settings.onboarded ? (
        <div className="welcome">
          <AppMark size={64} />
          <h1>Welcome to Solamar</h1>
          <p>Spaces, tabs you can tell apart and an ad blocker built in. No account, everything stays on this PC.</p>
          <div className="welcome-actions">
            <button className="btn primary" onClick={() => call('openOverlay', 'import')}>
              Import my Arc spaces
            </button>
            <button className="btn" onClick={() => call('openOverlay', 'import-browser')}>
              From Chrome, Edge or Firefox
            </button>
            <button className="btn ghost" onClick={() => call('updateSettings', { onboarded: true }).then(() => call('run', 'newTab'))}>
              Start fresh
            </button>
          </div>
          <p className="fine">Arc stops working on December 22, 2026. Solamar reads your Arc sidebar on this PC and brings your spaces, pinned tabs and folders over.</p>
        </div>
      ) : (
        <div className="empty-hint">
          <span className="empty-icon">
            <SpaceIcon id={space?.icon} size={24} />
          </span>
          <p>
            Nothing open in <strong>{space?.title}</strong>.
          </p>
          <button className="btn" onClick={() => call('run', 'newTab')}>
            Open something <kbd>{s.settings.shortcuts.newTab}</kbd>
          </button>
        </div>
      )}
    </div>
  )
}
