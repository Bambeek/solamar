// Parser for Arc's StorableSidebar.json (format notes in MODLOG.md). Pure: no Electron, no file access.
// Arc writes Swift dictionaries as flat alternating lists: [key, value, key, value, ...].

export interface ArcNode {
  kind: 'tab' | 'folder'
  title?: string
  url?: string
  children?: ArcNode[]
}

export interface ArcSpace {
  id: string
  title: string
  emoji?: string
  color?: string
  profile: string // 'default' or a stable key for a custom Arc profile
  pinned: ArcNode[]
  today: ArcNode[]
}

export interface ArcPlan {
  version: number
  spaces: ArcSpace[]
  favorites: ArcNode[]
}

type Json = Record<string, any>

export class ArcFormatError extends Error {}

/** Swift dictionary (alternating list) or plain object -> ordered entries. */
export function swiftEntries(v: unknown): [string, Json][] {
  if (Array.isArray(v)) {
    const out: [string, Json][] = []
    for (let i = 0; i + 1 < v.length; i += 2) {
      const k = v[i]
      const val = v[i + 1]
      if (val && typeof val === 'object') out.push([typeof k === 'string' ? k : JSON.stringify(k), val as Json])
    }
    return out
  }
  if (v && typeof v === 'object') return Object.entries(v as Json).filter(([, x]) => x && typeof x === 'object') as [string, Json][]
  return []
}

/** Alternating ["pinned", id, "unpinned", id] -> { pinned: id, unpinned: id }. Keys may be strings or {pinned:{}} objects. */
function containerMap(list: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(list)) return out
  for (let i = 0; i + 1 < list.length; i += 2) {
    const k = list[i]
    const id = list[i + 1]
    if (typeof id !== 'string') continue
    const name = typeof k === 'string' ? k : k && typeof k === 'object' ? Object.keys(k)[0] : ''
    if (name && !out[name]) out[name] = id
  }
  return out
}

function colorOf(theme: Json | undefined): string | undefined {
  const c = theme?.primaryColorPalette?.midTone
  if (!c || typeof c.red !== 'number') return undefined
  const big = Math.max(c.red, c.green, c.blue) > 1
  const to = (x: number) => Math.max(0, Math.min(255, Math.round(big ? x : x * 255)))
  return '#' + [c.red, c.green, c.blue].map((x: number) => to(x).toString(16).padStart(2, '0')).join('')
}

function emojiOf(icon: Json | undefined): string | undefined {
  if (!icon) return undefined
  if (typeof icon.emoji_v2 === 'string' && icon.emoji_v2) return icon.emoji_v2
  if (typeof icon.emoji === 'number' && icon.emoji > 0) {
    try {
      return String.fromCodePoint(icon.emoji)
    } catch {
      return undefined
    }
  }
  return undefined
}

function profileKey(p: Json | undefined): string {
  if (!p || p.default) return 'default'
  return 'custom:' + JSON.stringify(p).slice(0, 120)
}

export function parseArcSidebar(doc: unknown): ArcPlan {
  const root = doc as Json
  const containers = root?.sidebar?.containers
  if (!Array.isArray(containers)) throw new ArcFormatError('This does not look like an Arc sidebar file (no sidebar.containers).')
  const version = typeof root.version === 'number' ? root.version : 0
  if (version > 1) throw new ArcFormatError(`Arc sidebar format version ${version} is newer than this importer knows (1).`)
  const main = containers.find((c: Json) => c && c.spaces && c.items)
  if (!main) throw new ArcFormatError('No spaces found in the Arc sidebar file.')

  const items = new Map(swiftEntries(main.items))

  const walk = (id: string, seen: Set<string>, depth: number): ArcNode[] => {
    if (seen.has(id) || depth > 24) return []
    seen.add(id)
    const it = items.get(id)
    if (!it) return []
    const data = (it.data ?? {}) as Json
    const kids = (): ArcNode[] =>
      (Array.isArray(it.childrenIds) ? it.childrenIds : []).flatMap((c: unknown) => (typeof c === 'string' ? walk(c, seen, depth + 1) : []))
    if (data.tab) {
      const url = data.tab.savedURL
      if (typeof url !== 'string' || !url) return []
      const title = (typeof it.title === 'string' && it.title) || data.tab.savedTitle || undefined
      return [{ kind: 'tab', url, title }]
    }
    if (data.list) return [{ kind: 'folder', title: it.title || 'Folder', children: kids() }]
    // Containers, split views and anything newer: keep their tabs, drop the wrapper.
    return kids()
  }

  const sectionOf = (containerId: string | undefined) => (containerId ? walk(containerId, new Set(), 0) : [])

  const spaces: ArcSpace[] = swiftEntries(main.spaces).map(([key, s]) => {
    const ids = containerMap(s.containerIDs ?? s.newContainerIDs)
    return {
      id: typeof s.id === 'string' ? s.id : key,
      title: typeof s.title === 'string' && s.title ? s.title : 'Space',
      emoji: emojiOf(s.customInfo?.iconType),
      color: colorOf(s.customInfo?.windowTheme),
      profile: profileKey(s.profile),
      pinned: sectionOf(ids.pinned),
      today: sectionOf(ids.unpinned)
    }
  })

  // Favorites: topAppsContainerIDs = [{default:true}, containerId, ...]; take the default profile's set.
  let favorites: ArcNode[] = []
  const top = main.topAppsContainerIDs
  if (Array.isArray(top)) {
    for (let i = 0; i + 1 < top.length; i += 2) {
      const k = top[i]
      if (typeof top[i + 1] === 'string' && (k?.default || i === 0)) {
        favorites = sectionOf(top[i + 1]).flatMap(flattenTabs)
        if (k?.default) break
      }
    }
  }

  return { version, spaces, favorites }
}

export function flattenTabs(n: ArcNode): ArcNode[] {
  return n.kind === 'tab' ? [n] : (n.children ?? []).flatMap(flattenTabs)
}

export function countNodes(nodes: ArcNode[]): { tabs: number; folders: number } {
  let tabs = 0
  let folders = 0
  const visit = (n: ArcNode) => {
    if (n.kind === 'tab') tabs++
    else {
      folders++
      n.children?.forEach(visit)
    }
  }
  nodes.forEach(visit)
  return { tabs, folders }
}
