// Finds installed browsers' profiles. Only looks at files: nothing is opened for writing.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { BROWSER_NAMES, type BrowserId, type ImportSource } from './types'

export interface LocateEnv {
  platform: NodeJS.Platform
  home: string
  localAppData?: string // Windows %LOCALAPPDATA%
  appData?: string // Windows %APPDATA%
}

export function currentEnv(): LocateEnv {
  const home = homedir()
  return {
    platform: process.platform,
    home,
    localAppData: process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'),
    appData: process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  }
}

type Chromium = 'chrome' | 'edge' | 'brave'

/** The "User Data" folder of each Chromium browser on this OS. */
export function chromiumRoots(env: LocateEnv): [Chromium, string][] {
  const { platform, home } = env
  if (platform === 'win32') {
    const local = env.localAppData ?? join(home, 'AppData', 'Local')
    return [
      ['chrome', join(local, 'Google', 'Chrome', 'User Data')],
      ['edge', join(local, 'Microsoft', 'Edge', 'User Data')],
      ['brave', join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')]
    ]
  }
  if (platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    return [
      ['chrome', join(support, 'Google', 'Chrome')],
      ['edge', join(support, 'Microsoft Edge')],
      ['brave', join(support, 'BraveSoftware', 'Brave-Browser')]
    ]
  }
  const config = join(home, '.config')
  return [
    ['chrome', join(config, 'google-chrome')],
    ['edge', join(config, 'microsoft-edge')],
    ['brave', join(config, 'BraveSoftware', 'Brave-Browser')]
  ]
}

/** Folders that may hold profiles.ini (snap and flatpak builds keep their own copy on Linux). */
export function firefoxRoots(env: LocateEnv): string[] {
  const { platform, home } = env
  if (platform === 'win32') return [join(env.appData ?? join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox')]
  if (platform === 'darwin') return [join(home, 'Library', 'Application Support', 'Firefox')]
  return [join(home, '.mozilla', 'firefox'), join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'), join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox')]
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Exists but cannot be opened: macOS privacy protection (Full Disk Access) does exactly this. */
const blocked = (p: string) => {
  if (!isFile(p)) return false
  try {
    closeSync(openSync(p, 'r'))
    return false
  } catch {
    return true
  }
}

const profileOrder = (dir: string) => (dir === 'Default' ? 0 : Number(dir.match(/^Profile (\d+)$/)?.[1] ?? 1e6))

function chromiumProfiles(browser: Chromium, userData: string): ImportSource[] {
  if (!isDir(userData)) return []
  // Local State names the profiles ("Work", "Person 1") and says which one was used last.
  let info: Record<string, { name?: string }> = {}
  let lastUsed = 'Default'
  try {
    const state = JSON.parse(readFileSync(join(userData, 'Local State'), 'utf-8'))
    if (state?.profile?.info_cache && typeof state.profile.info_cache === 'object') info = state.profile.info_cache
    if (typeof state?.profile?.last_used === 'string' && state.profile.last_used) lastUsed = state.profile.last_used
  } catch {}
  const dirs = new Set(Object.keys(info))
  try {
    for (const d of readdirSync(userData)) if (d === 'Default' || /^Profile \d+$/.test(d)) dirs.add(d)
  } catch {}
  const out: ImportSource[] = []
  for (const dir of [...dirs].sort((a, b) => profileOrder(a) - profileOrder(b) || a.localeCompare(b))) {
    const profilePath = join(userData, dir)
    const has = { bookmarks: isFile(join(profilePath, 'Bookmarks')), history: isFile(join(profilePath, 'History')) }
    if (!has.bookmarks && !has.history) continue
    const name = typeof info[dir]?.name === 'string' && info[dir].name ? info[dir].name! : dir
    out.push({ browser, browserName: BROWSER_NAMES[browser], profileName: name, profilePath, isDefault: dir === lastUsed, has })
  }
  return out
}

export interface IniProfile {
  name: string
  path: string // absolute
  isDefault: boolean
}

/** profiles.ini: [ProfileN] sections, plus [Install...] sections whose Default= is the profile each install really uses. */
export function parseProfilesIni(text: string, base: string): IniProfile[] {
  const sections: { name: string; keys: Record<string, string> }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) sections.push({ name: sec[1], keys: {} })
    else if (sections.length) {
      const eq = line.indexOf('=')
      if (eq > 0) sections[sections.length - 1].keys[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
  }
  const resolve = (p: string, relative: boolean) => (relative || !isAbsolute(p) ? join(base, ...p.split(/[\\/]/)) : p)
  const installDefaults = new Set(sections.filter((s) => /^Install/i.test(s.name) && s.keys.Default).map((s) => resolve(s.keys.Default, true)))
  const profiles = sections
    .filter((s) => /^Profile\d+$/i.test(s.name) && s.keys.Path)
    .map((s) => ({ name: s.keys.Name || s.keys.Path, path: resolve(s.keys.Path, s.keys.IsRelative !== '0'), flagged: s.keys.Default === '1' }))
  const anyInstall = profiles.some((p) => installDefaults.has(p.path))
  return profiles.map((p) => ({ name: p.name, path: p.path, isDefault: anyInstall ? installDefaults.has(p.path) : p.flagged }))
}

function firefoxProfiles(root: string): ImportSource[] {
  if (!isDir(root)) return []
  let profiles: IniProfile[] = []
  try {
    profiles = parseProfilesIni(readFileSync(join(root, 'profiles.ini'), 'utf-8'), root)
  } catch {
    // No profiles.ini: fall back to whatever sits in Profiles/.
    try {
      profiles = readdirSync(join(root, 'Profiles')).map((d, i) => ({ name: d.replace(/^[^.]+\./, ''), path: join(root, 'Profiles', d), isDefault: i === 0 }))
    } catch {}
  }
  return profiles
    .filter((p) => isFile(join(p.path, 'places.sqlite')))
    .map((p) => ({ browser: 'firefox' as const, browserName: BROWSER_NAMES.firefox, profileName: p.name, profilePath: p.path, isDefault: p.isDefault, has: { bookmarks: true, history: true } }))
}

function safariSource(env: LocateEnv): ImportSource[] {
  if (env.platform !== 'darwin') return []
  const dir = join(env.home, 'Library', 'Safari')
  const bm = join(dir, 'Bookmarks.plist')
  const hist = join(dir, 'History.db')
  const has = { bookmarks: existsSync(bm), history: existsSync(hist) }
  if (!has.bookmarks && !has.history) return []
  const needsPermission = blocked(bm) || blocked(hist)
  return [{ browser: 'safari', browserName: BROWSER_NAMES.safari, profileName: 'Default', profilePath: dir, isDefault: true, has, ...(needsPermission ? { needsPermission } : {}) }]
}

/** Every importable profile on this computer, default profile first within each browser. */
export function listSources(env: LocateEnv = currentEnv()): ImportSource[] {
  const out: ImportSource[] = []
  for (const [browser, root] of chromiumRoots(env)) out.push(...chromiumProfiles(browser, root))
  const seen = new Set<string>()
  for (const root of firefoxRoots(env)) {
    for (const s of firefoxProfiles(root)) {
      if (seen.has(s.profilePath)) continue
      seen.add(s.profilePath)
      out.push(s)
    }
  }
  out.push(...safariSource(env))
  const rank: BrowserId[] = ['chrome', 'edge', 'brave', 'firefox', 'safari']
  return out.sort((a, b) => rank.indexOf(a.browser) - rank.indexOf(b.browser) || Number(b.isDefault) - Number(a.isDefault))
}
