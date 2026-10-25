// Data shared by the main process and the UI, including the persisted document (store.ts).

export type Section = 'favorites' | 'pinned' | 'today'
export type ThemeMode = 'auto' | 'light' | 'dark'
export type Texture = 'none' | 'grain' | 'dots'

export interface SpaceTheme {
  color: string // main hex colour
  color2?: string // optional second gradient stop
  mode: ThemeMode
  texture: Texture
  intensity: number // 0..1, how strongly the colour tints the window
}

export interface Profile {
  id: string
  name: string
  partition: string
  isDefault: boolean
  ephemeral?: boolean // private browsing: in-memory session, never saved
}

export interface Space {
  id: string
  profileId: string
  title: string
  icon: string // Lucide icon id from shared/icons.ts
  theme: SpaceTheme
  position: number
  agent?: boolean // the Claude space, where Claude Code opens its tabs
  private?: boolean // private browsing: not saved, no history
}

export interface Item {
  id: string
  spaceId: string | null // null for favorites, which are shared by all spaces
  parentId: string | null // a folder id, or null for the top of the section
  kind: 'tab' | 'folder'
  section: Section
  title?: string // page title (tabs) or folder name
  customTitle?: string // user's rename of a tab
  url?: string
  favicon?: string
  position: number
  createdAt: number
  lastActiveAt: number
  muted?: boolean
  collapsed?: boolean // folders
  shared?: boolean // the user shared this tab with Claude Code
}

export interface ArchivedItem {
  id: string
  spaceId: string | null
  title?: string
  url: string
  favicon?: string
  archivedAt: number
}

export interface HistoryEntry {
  url: string
  title?: string
  lastVisit: number
  visits: number
}

export type BoostFilter = 'none' | 'dark' | 'sepia' | 'gray'

/** Per-site changes the user makes to a page: colours, font, zapped elements, own CSS and JS. */
export interface Boost {
  id: string
  domain: string // the site and its subdomains
  css: string
  js: string // runs in the page when it loads
  enabled: boolean
  zaps: string[] // CSS selectors of elements hidden on the site
  font: string // a BOOST_FONTS id, '' = the site's own
  filter: BoostFilter
  hue: number // 0-359: page colours turned around the colour wheel (pictures keep theirs)
}

export type SearchEngine = 'duckduckgo' | 'google' | 'bing' | 'brave' | 'startpage'

export type CommandId =
  | 'newTab'
  | 'focusUrl'
  | 'closeTab'
  | 'reopenTab'
  | 'reload'
  | 'hardReload'
  | 'back'
  | 'forward'
  | 'toggleSidebar'
  | 'pinTab'
  | 'nextTab'
  | 'prevTab'
  | 'nextSpace'
  | 'prevSpace'
  | 'copyUrl'
  | 'splitView'
  | 'settings'
  | 'archive'
  | 'history'
  | 'downloads'
  | 'privateSpace'
  | 'aiPanel'
  | 'aiSummarize'
  | 'aiWrite'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'devtools'

export type EngineId = 'ollama' | 'anthropic' | 'claude-code'
export type AiFeature = 'summarize' | 'ask' | 'tidy' | 'write' | 'search' | 'agent'

export interface AiSettings {
  enabled: boolean
  engine: EngineId // default engine
  features: Partial<Record<AiFeature, EngineId>> // per-feature overrides
  host: string // Ollama, this computer only
  model: string // Ollama model
  anthropicModel: string
  claudeCodeModel: string // '' = Claude Code's default model; or opus / sonnet / haiku
}

export type SiteGrant = 'allow' | 'block'

export interface AgentSettings {
  mcpEnabled: boolean // Claude Code may connect to Solamar's local MCP server
  siteAccess: 'all' | 'ask' // all: any site except blocked ones; ask: a prompt for each new site
  approvals: 'auto' | 'ask' // auto: works on its own, asks only before payments; ask: also before send, submit, delete
  port: number
  allTabs: boolean // false: only the Claude space and tabs the user shared
  grants: Record<string, SiteGrant> // per site, remembered answers
}

/** Icons a user can pick for the app window; the files are src/renderer/src/assets/app-icons/<id>.svg and build/icons/<id>.ico. */
export type AppIconId = 'sunset' | 'day' | 'night' | 'ink' | 'violet'

export interface Settings {
  searchEngine: SearchEngine
  archiveAfterHours: number // 0 = never
  sleepAfterMinutes: number // 0 = never
  adblock: { enabled: boolean; allowlist: string[] }
  ai: AiSettings
  agent: AgentSettings
  shortcuts: Record<CommandId, string>
  sidebarWidth: number
  sidebarVisible: boolean // bar layout: the row of tabs; sidebar layout: the sidebar
  layout: 'bar' | 'sidebar' // bar: spaces and address in a top bar, a row of titled tabs under it; sidebar: the classic Arc-style sidebar
  onboarded: boolean
  sitePermissions: Record<string, 'allow' | 'block'> // "site|permission" -> remembered answer
  passwords: { offer: boolean; never: string[]; lockAfter: number } // offer to save after a login; sites never to ask about; with a master password, lock after this many idle minutes (0: only when Solamar closes)
  clipsDir: string // where "Save page for Claude" writes; '' = Documents/Solamar Clips
  peekFromPinned: boolean // links from pinned tabs and favorites to other sites open in Peek
  autoPip: boolean // a video playing with sound pops out when you switch tabs
  appIcon: AppIconId // the window and taskbar icon, picked in Settings > Appearance
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  focusedSpaceId: string
  activeBySpace: Record<string, string | null>
  split: string[] // item ids shown side by side with the active tab
  bounds?: Bounds
  maximized: boolean
}

export interface DownloadEntry {
  id: string
  name: string
  url: string
  path: string
  received: number
  total: number // 0 when unknown
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
  private?: boolean
}

export interface Doc {
  version: 1
  profiles: Profile[]
  spaces: Space[]
  items: Item[]
  archive: ArchivedItem[]
  history: HistoryEntry[]
  boosts: Boost[]
  downloads: DownloadEntry[]
  settings: Settings
  window: WindowState
}

// Runtime state, not persisted.

export interface TabRuntime {
  awake: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  audible: boolean
  blocked: number
  zoom: number
  crashed?: boolean
  playing?: boolean // a video or audio element is playing
}

/** A page previewed over the current tab; it can become a real tab without reloading. */
export interface PeekState {
  url: string
  title: string
  loading: boolean
  rect: Bounds // where the page sits in the window; the overlay draws the card around it
}

/** The tab behind the mini player: media that started with sound in a tab you are not looking at. */
export interface MediaState {
  id: string
  title: string
  artist: string
  site: string
  playing: boolean
  video: boolean
  muted: boolean
}

/** A saved login as Solamar's UI sees it: never the password. */
export interface LoginInfo {
  id: string
  origin: string // https://accounts.example.com
  username: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

/** "Save password for example.com?" after a login on a page. */
export interface SavePasswordPrompt {
  id: string
  site: string
  username: string
  update: boolean // a saved login for this user gets a new password
  locked: boolean // saving needs the master password first
}

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
}

/** "Add <extension> to Solamar?" after Add to Chrome on the Chrome Web Store. */
export interface ExtensionInstallPrompt {
  id: string
  extensionId: string
  name: string
  icon: string // data URL, '' when the store had none
  permissions: string[] // plain-words list of what it may do
}

export interface Notice {
  id: string
  text: string
  path?: string // a folder the notice can open
  action?: { label: string; call: string } // a button that calls this api method (no arguments)
  error?: boolean
}

/** Updates (main/updates.ts): off in dev and personal builds; 'manual' = a new version exists but this build cannot
 *  install it itself (macOS without signing), so it only links to the release. */
export interface UpdateState {
  status: 'off' | 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'manual' | 'error'
  version: string // this build
  next?: string // the new version
  progress?: number
  checkedAt?: number
  error?: string
  offReason?: 'dev' | 'personal'
}

/** A browser profile Solamar can import from, as the import dialog sees it (no file paths). */
export interface BrowserSourceInfo {
  i: number
  browser: 'chrome' | 'edge' | 'brave' | 'firefox' | 'safari'
  browserName: string
  profileName: string
  isDefault: boolean
  has: { bookmarks: boolean; history: boolean }
  needsPermission?: boolean
}

/** One request to the page agent and what came of it; steps come from the agent log. */
export interface PageAgentTurn {
  task: string
  url: string // the page it was asked on
  since: number // agent log steps from this time on belong to the turn
  until?: number // ... up to this time, once it has finished
  text: string // its streamed notes and reply
  error?: string
}

/** Solamar's own page agent: the current turn on the user's tab, after the earlier turns of the same conversation. */
export interface PageAgentState extends PageAgentTurn {
  tabId: string
  running: boolean
  earlier: PageAgentTurn[] // oldest first; "New conversation" clears them
}

export interface BoostEditorState {
  id: string
  zapping: boolean
}

export type OverlayKind = 'command' | 'settings' | 'theme' | 'import' | 'archive' | 'space-new' | 'confirm' | 'resize' | 'permission' | 'write' | 'downloads' | 'history' | 'peek' | 'import-browser' | 'save-password' | 'extension-install' | 'notice' | 'vault-unlock'

export interface OverlayState {
  kind: OverlayKind
  payload?: { mode?: 'new' | 'edit'; spaceId?: string; text?: string; tab?: string }
}

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TidyGroup {
  title: string
  itemIds: string[]
}

export interface AiState {
  panelOpen: boolean
  available: boolean | null // null = not checked yet (for the default engine)
  models: string[] // Ollama models
  hasKey: boolean // an Anthropic API key is stored in the OS keychain
  claudeCodeAllowed: boolean // personal builds may run AI features through the user's own Claude Code
  keyStorage: boolean // the OS keychain is usable
  busy: boolean
  messages: AiMessage[]
  tidy: TidyGroup[] | null
  error?: string
}

export interface AgentStep {
  at: number
  tool: string
  target: string
  outcome: 'ok' | 'denied' | 'blocked' | 'waiting' | 'error'
  note?: string
}

export interface ClaudeCliState {
  checked: boolean
  installed: boolean
  version?: string
  registered: 'yes' | 'no' | 'stale' | 'unknown' // stale: an entry with another port or secret
  loggedIn: boolean | null
  plan?: string
  busy?: boolean
  message?: string
}

export interface AgentState {
  serving: boolean // MCP server is listening
  lastCall: number // last tool call from Claude Code (ms epoch), 0 = never
  cli: ClaudeCliState
  active: boolean // a client called a tool in the last 20 s
  paused: boolean // user pressed Stop
  command: string // the `claude mcp add` line to copy, includes the secret
  log: AgentStep[]
  spaceId: string | null
}

export interface ConfirmRequest {
  id: string
  kind: 'action' | 'site'
  site: string
  title: string
  detail: string
}

export interface PermissionRequest {
  id: string
  site: string
  permission: string // media, geolocation, notifications, midi, display-capture, idle-detection
  detail?: string // e.g. "camera and microphone"
}

export interface WriteState {
  site: string
  field: string
  original: string // the selection, or the whole field
  scope: 'selection' | 'field'
  busy: boolean
  result: string
  error?: string
  applied?: boolean
}

export interface AnswerState {
  question: string
  busy: boolean
  text: string
  sources: { title: string; url: string }[]
  web: boolean // the engine searched the web
  error?: string
}

/** A still picture of a page shown while the page area slides (x, y relative to the page area). */
export interface PageSnapshot {
  src: string
  x: number
  y: number
  width: number
  height: number
}

export interface AppState {
  profiles: Profile[]
  spaces: Space[]
  items: Item[]
  boosts: Boost[]
  settings: Settings
  window: WindowState
  activeId: string | null
  runtime: Record<string, TabRuntime>
  overlay: OverlayState | null
  ai: AiState
  agent: AgentState
  confirm: ConfirmRequest | null
  permission: PermissionRequest | null
  write: WriteState | null
  layoutSnapshot: PageSnapshot[] | null
  answer: AnswerState | null
  adblockReady: boolean
  maximized: boolean
  archiveCount: number
  restoredAfterCrash: boolean // show the 'Solamar did not close properly' notice
  downloads: DownloadEntry[]
  peek: PeekState | null
  savePassword: SavePasswordPrompt | null
  pageAgent: PageAgentState | null
  notice: Notice | null // a short message at the bottom of the window
  update: UpdateState
  clipsRoot: string // the folder pages saved for Claude go to
  extensions: ExtensionInfo[] // loaded in the active tab's profile
  extensionInstall: ExtensionInstallPrompt | null
  activeWcId: number | null // the active tab's page, for the extensions toolbar
  activePartition: string
  passwords: { available: boolean; count: number; locked: boolean; master: boolean; osAuth: 'windows-hello' | 'touch-id' | 'none' } // available: the OS keychain can encrypt them; osAuth: how Solamar confirms it is you before showing one
  media: MediaState | null
  boostEditor: BoostEditorState | null
  platform: NodeJS.Platform
}

export type ResultKind = 'url' | 'search' | 'tab' | 'history' | 'action'

export interface CommandResult {
  id: string
  kind: ResultKind
  title: string
  subtitle?: string
  url?: string
  favicon?: string
  itemId?: string
  action?: string
  score: number
}

export interface ArcPreviewSpace {
  title: string
  icon: string
  color?: string
  pinned: number
  today: number
  folders: number
}

export interface ArcPreview {
  path: string
  spaces: ArcPreviewSpace[]
  favorites: number
}

export interface ImportSummary {
  spaces: number
  tabs: number
  folders: number
  favorites: number
}
