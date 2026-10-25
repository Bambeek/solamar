import type { AiFeature, AppIconId, CommandId, Settings, SpaceTheme } from './types'

export const DEFAULT_SHORTCUTS: Record<CommandId, string> = {
  newTab: 'Ctrl+T',
  focusUrl: 'Ctrl+L',
  closeTab: 'Ctrl+W',
  reopenTab: 'Ctrl+Shift+T',
  reload: 'Ctrl+R',
  hardReload: 'Ctrl+Shift+R',
  back: 'Alt+Left',
  forward: 'Alt+Right',
  toggleSidebar: 'Ctrl+S',
  pinTab: 'Ctrl+D',
  nextTab: 'Ctrl+Tab',
  prevTab: 'Ctrl+Shift+Tab',
  nextSpace: 'Ctrl+Alt+Right',
  prevSpace: 'Ctrl+Alt+Left',
  copyUrl: 'Ctrl+Shift+C',
  splitView: 'Ctrl+Shift+=',
  settings: 'Ctrl+,',
  archive: 'Ctrl+Shift+A',
  history: 'Ctrl+H',
  downloads: 'Ctrl+Shift+Y',
  privateSpace: 'Ctrl+Shift+N',
  aiPanel: 'Ctrl+J',
  aiSummarize: 'Ctrl+Shift+J',
  aiWrite: 'Ctrl+Shift+Space',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0',
  devtools: 'F12'
}

export const COMMAND_LABELS: Record<CommandId, string> = {
  newTab: 'New tab / command bar',
  focusUrl: 'Edit address',
  closeTab: 'Close tab',
  reopenTab: 'Reopen closed tab',
  reload: 'Reload',
  hardReload: 'Reload without cache',
  back: 'Back',
  forward: 'Forward',
  toggleSidebar: 'Show or hide sidebar',
  pinTab: 'Pin or unpin tab',
  nextTab: 'Next tab',
  prevTab: 'Previous tab',
  nextSpace: 'Next space',
  prevSpace: 'Previous space',
  copyUrl: 'Copy page address',
  splitView: 'Split view with next tab',
  settings: 'Settings',
  archive: 'Archived tabs',
  history: 'History',
  downloads: 'Downloads',
  privateSpace: 'Private space (incognito)',
  aiPanel: 'Local AI panel',
  aiSummarize: 'Summarize page (AI)',
  aiWrite: 'Write with AI in a text field',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomReset: 'Reset zoom',
  devtools: 'Developer tools'
}

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'duckduckgo',
  archiveAfterHours: 12,
  sleepAfterMinutes: 30,
  adblock: { enabled: true, allowlist: [] },
  ai: { enabled: false, engine: 'ollama', features: {}, host: 'http://127.0.0.1:11434', model: '', anthropicModel: 'claude-opus-5-5', claudeCodeModel: '' },
  agent: { mcpEnabled: false, siteAccess: 'all', approvals: 'auto', port: 47821, allTabs: false, grants: {} },
  shortcuts: { ...DEFAULT_SHORTCUTS },
  sidebarWidth: 264,
  sidebarVisible: true,
  layout: 'bar',
  onboarded: false,
  sitePermissions: {},
  passwords: { offer: true, never: [], lockAfter: 15 },
  clipsDir: '',
  peekFromPinned: true,
  autoPip: true,
  appIcon: 'violet'
}

/** The app icons offered in Settings > Appearance, in the order shown. */
export const APP_ICONS: { id: AppIconId; label: string }[] = [
  { id: 'violet', label: 'Classic' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'day', label: 'Daylight' },
  { id: 'night', label: 'Moonlit' },
  { id: 'ink', label: 'Ink' },
]

// Fonts a boost can put on a page: stacks of fonts that ship with Windows and macOS, nothing downloaded.
export const BOOST_FONTS: { id: string; label: string; stack: string }[] = [
  { id: '', label: "Site's own", stack: '' },
  { id: 'sans', label: 'Sans', stack: 'system-ui, "Segoe UI", -apple-system, Roboto, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Charter, Georgia, Cambria, "Times New Roman", serif' },
  { id: 'mono', label: 'Mono', stack: '"Cascadia Mono", Consolas, Menlo, monospace' },
  { id: 'wide', label: 'Wide', stack: 'Verdana, Tahoma, sans-serif' }
]

// Space colour presets: our own palette, chosen for contrast with both light and dark text.
export const THEME_PRESETS: SpaceTheme[] = [
  { color: '#7c6cf2', color2: '#c58af5', mode: 'auto', texture: 'grain', intensity: 0.7 },
  { color: '#3b82f6', color2: '#22d3ee', mode: 'auto', texture: 'grain', intensity: 0.7 },
  { color: '#10b981', color2: '#a3e635', mode: 'auto', texture: 'grain', intensity: 0.6 },
  { color: '#f59e0b', color2: '#f97316', mode: 'auto', texture: 'grain', intensity: 0.6 },
  { color: '#ef4444', color2: '#ec4899', mode: 'auto', texture: 'grain', intensity: 0.65 },
  { color: '#64748b', color2: '#94a3b8', mode: 'auto', texture: 'none', intensity: 0.5 },
  { color: '#1e1b4b', color2: '#312e81', mode: 'dark', texture: 'grain', intensity: 0.9 },
  { color: '#f5f5f4', color2: '#e7e5e4', mode: 'light', texture: 'none', intensity: 0.4 }
]

// Anthropic models the user can pick for Solamar's AI features (their own API key). Default: Claude Opus 5.5.
export const ANTHROPIC_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
]

export const AI_FEATURES: { id: AiFeature; label: string }[] = [
  { id: 'summarize', label: 'Summarize page' },
  { id: 'ask', label: 'Ask about the page' },
  { id: 'tidy', label: 'Tidy tabs' },
  { id: 'write', label: 'Write with AI' },
  { id: 'search', label: 'Better search' },
  { id: 'agent', label: 'Page agent' }
]

export const SEARCH_ENGINES: Record<string, { name: string; url: string }> = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' }
}
