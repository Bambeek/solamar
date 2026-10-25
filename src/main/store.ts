// The persisted document: one JSON file in userData, written atomically (tmp + rename) and debounced.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, THEME_PRESETS } from '@shared/defaults'
import { iconFromEmoji, isSpaceIcon } from '@shared/icons'
import type { Doc } from '@shared/types'
import { uid } from '@shared/util'

export const DEFAULT_PROFILE_ID = 'p-default'

export function freshDoc(): Doc {
  const spaceId = uid('s-')
  return {
    version: 1,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Default', partition: 'persist:solamar-default', isDefault: true }],
    spaces: [{ id: spaceId, profileId: DEFAULT_PROFILE_ID, title: 'Personal', icon: 'house', theme: { ...THEME_PRESETS[0] }, position: 0 }],
    items: [],
    archive: [],
    history: [],
    boosts: [],
    downloads: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    window: { focusedSpaceId: spaceId, activeBySpace: {}, split: [], maximized: false }
  }
}

/** Fills keys added in newer versions so old files keep working. */
export function migrate(raw: any): Doc {
  const base = freshDoc()
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return base
  const doc: Doc = { ...base, ...raw }
  doc.settings = {
    ...base.settings,
    ...(raw.settings ?? {}),
    adblock: { ...base.settings.adblock, ...(raw.settings?.adblock ?? {}) },
    ai: { ...base.settings.ai, ...(raw.settings?.ai ?? {}), features: { ...(raw.settings?.ai?.features ?? {}) } },
    sitePermissions: { ...(raw.settings?.sitePermissions ?? {}) },
    passwords: { ...base.settings.passwords, ...(raw.settings?.passwords ?? {}), never: Array.isArray(raw.settings?.passwords?.never) ? raw.settings.passwords.never : [] },
    agent: { ...base.settings.agent, ...(raw.settings?.agent ?? {}), grants: { ...(raw.settings?.agent?.grants ?? {}) } },
    shortcuts: { ...DEFAULT_SHORTCUTS, ...(raw.settings?.shortcuts ?? {}) }
  }
  if (!Array.isArray(doc.profiles) || doc.profiles.length === 0) doc.profiles = base.profiles
  if (!Array.isArray(doc.spaces) || doc.spaces.length === 0) {
    doc.spaces = base.spaces
    doc.window = base.window
  }
  for (const k of ['items', 'archive', 'history', 'boosts', 'downloads'] as const) if (!Array.isArray(doc[k])) (doc as any)[k] = []
  // v0.1 boosts were CSS only.
  doc.boosts = doc.boosts.map((b: any) => ({ js: '', font: '', filter: 'none', hue: 0, ...b, zaps: Array.isArray(b.zaps) ? b.zaps : [] }))
  // v0.1 stored emoji; spaces now carry an icon id.
  doc.spaces.forEach((s: any, i) => {
    if (!isSpaceIcon(s.icon)) s.icon = iconFromEmoji(s.emoji, i)
    delete s.emoji
  })
  doc.window = { ...base.window, ...(raw.window ?? {}) }
  if (!doc.spaces.some((s) => s.id === doc.window.focusedSpaceId)) doc.window.focusedSpaceId = doc.spaces[0].id
  return doc
}

/** The document as written to disk: private spaces, their tabs, profiles and downloads are left out. */
export function persistable(doc: Doc): Doc {
  const priv = new Set(doc.spaces.filter((s) => s.private).map((s) => s.id))
  if (!priv.size && !doc.downloads.some((d) => d.private) && !doc.profiles.some((p) => p.ephemeral)) return doc
  const spaces = doc.spaces.filter((s) => !priv.has(s.id))
  const keep = (spaceId: string | null) => !spaceId || !priv.has(spaceId)
  return {
    ...doc,
    profiles: doc.profiles.filter((p) => !p.ephemeral),
    spaces,
    items: doc.items.filter((i) => keep(i.spaceId)),
    archive: doc.archive.filter((a) => keep(a.spaceId)),
    downloads: doc.downloads.filter((d) => !d.private),
    window: {
      ...doc.window,
      focusedSpaceId: priv.has(doc.window.focusedSpaceId) ? (spaces[0]?.id ?? doc.window.focusedSpaceId) : doc.window.focusedSpaceId,
      activeBySpace: Object.fromEntries(Object.entries(doc.window.activeBySpace).filter(([k]) => !priv.has(k)))
    }
  }
}

export class Store {
  doc: Doc
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly file: string) {
    this.doc = this.load()
  }

  private load(): Doc {
    if (!existsSync(this.file)) return freshDoc()
    try {
      return migrate(JSON.parse(readFileSync(this.file, 'utf-8')))
    } catch (err) {
      // Keep the unreadable file for inspection instead of overwriting it.
      try {
        renameSync(this.file, this.file + '.broken-' + Date.now())
      } catch {}
      console.error('[store] could not read', this.file, err)
      return freshDoc()
    }
  }

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 400)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(persistable(this.doc)))
    renameSync(tmp, this.file)
  }
}
