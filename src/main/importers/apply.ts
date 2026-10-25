// Merges ImportData into the Doc: bookmarks become pinned folders and tabs in one space, history joins doc.history.
import { THEME_PRESETS } from '@shared/defaults'
import type { Doc, HistoryEntry, Item } from '@shared/types'
import { uid } from '@shared/util'
import { DEFAULT_PROFILE_ID } from '../store'
import { BROWSER_NAMES, type BookmarkNode, type ImportData } from './types'

export const MAX_BOOKMARKS = 2000
export const MAX_HISTORY = 5000 // same cap the app keeps for its own history
const MAX_DEPTH = 8 // deeper folders are flattened into their ancestor at this depth

export interface ApplyOptions {
  spaceId?: string // add bookmarks to this existing space; otherwise a new space is made
  spaceTitle?: string // name of the new space, default "<Browser> bookmarks"
  bookmarks?: boolean // default true
  history?: boolean // default true
}

export interface ApplyResult {
  bookmarks: number // tabs added
  folders: number
  history: number // imported pages now in doc.history (new or merged)
  skipped: number // bookmarks left out: duplicate, unsupported URL, or over the cap
  spaceId: string | null // where the bookmarks went; null when none were added
}

/** Pages Solamar can open. Drops javascript:, chrome:, about:, extension pages, place: queries and the like. */
export function importableUrl(url: string): boolean {
  return /^(https?|file):/i.test(url)
}

type Clean = { kind: 'tab'; title?: string; url: string } | { kind: 'folder'; title: string; children: Clean[] }

export function applyImport(doc: Doc, data: ImportData, opts: ApplyOptions = {}, now = Date.now()): ApplyResult {
  const result: ApplyResult = { bookmarks: 0, folders: 0, history: 0, skipped: 0, spaceId: null }
  if (opts.bookmarks !== false && data.bookmarks.length) addBookmarks(doc, data, opts, now, result)
  if (opts.history !== false && data.history.length) result.history = mergeHistory(doc, data, now)
  return result
}

function addBookmarks(doc: Doc, data: ImportData, opts: ApplyOptions, now: number, result: ApplyResult): void {
  const target = opts.spaceId ? doc.spaces.find((s) => s.id === opts.spaceId) : undefined
  const seen = new Set(target ? doc.items.filter((i) => i.spaceId === target.id && i.url).map((i) => i.url!) : [])
  let budget = MAX_BOOKMARKS

  const clean = (nodes: BookmarkNode[], depth: number): Clean[] => {
    const out: Clean[] = []
    for (const n of nodes) {
      if (n.kind === 'bookmark') {
        const url = n.url?.trim() ?? ''
        if (!importableUrl(url) || seen.has(url) || budget <= 0) {
          result.skipped++
          continue
        }
        seen.add(url)
        budget--
        out.push({ kind: 'tab', title: n.title.trim() || undefined, url })
      } else {
        const children = clean(n.children ?? [], depth + 1)
        if (!children.length) continue // empty, or everything inside was skipped
        if (depth >= MAX_DEPTH) out.push(...children)
        else out.push({ kind: 'folder', title: n.title.trim() || 'Folder', children })
      }
    }
    return out
  }

  // The toolbar's contents go to the top of the space; other roots (Other bookmarks, Mobile...) stay folders.
  const top: Clean[] = []
  for (const n of data.bookmarks) {
    if (n.kind === 'folder' && n.root === 'toolbar') top.push(...clean(n.children ?? [], 0))
    else top.push(...clean([n], 0))
  }
  if (!top.length) return

  let space = target
  if (!space) {
    const profileId = doc.profiles.find((p) => p.isDefault)?.id ?? doc.profiles[0]?.id ?? DEFAULT_PROFILE_ID
    const base = opts.spaceTitle?.trim() || (data.browser ? `${BROWSER_NAMES[data.browser]} bookmarks` : 'Imported bookmarks')
    let title = base
    for (let n = 2; doc.spaces.some((s) => s.title === title); n++) title = `${base} ${n}`
    space = {
      id: uid('s-'),
      profileId,
      title,
      icon: 'star',
      theme: { ...THEME_PRESETS[doc.spaces.length % THEME_PRESETS.length] },
      position: Math.max(-1, ...doc.spaces.map((s) => s.position)) + 1
    }
    doc.spaces.push(space)
  }
  const spaceId = space.id
  result.spaceId = spaceId

  const emit = (nodes: Clean[], parentId: string | null, start: number) => {
    nodes.forEach((n, i) => {
      const item: Item = {
        id: uid('i-'),
        spaceId,
        parentId,
        kind: n.kind,
        section: 'pinned',
        title: n.title,
        url: n.kind === 'tab' ? n.url : undefined,
        position: start + i,
        createdAt: now,
        lastActiveAt: now
      }
      doc.items.push(item)
      if (n.kind === 'tab') result.bookmarks++
      else {
        result.folders++
        emit(n.children, item.id, 0)
      }
    })
  }
  const after = doc.items.filter((i) => i.spaceId === spaceId && i.section === 'pinned' && i.parentId === null).map((i) => i.position)
  emit(top, null, Math.max(-1, ...after) + 1)
}

/** Dedupes by URL (most visits, latest visit win), keeps the newest MAX_HISTORY. Returns imported entries kept. */
function mergeHistory(doc: Doc, data: ImportData, now: number): number {
  const byUrl = new Map(doc.history.map((h) => [h.url, h]))
  const touched = new Set<HistoryEntry>()
  for (const v of data.history) {
    if (!/^https?:/i.test(v.url) || !(v.lastVisit > 0)) continue
    const lastVisit = Math.min(v.lastVisit, now)
    const visits = Math.max(1, Math.round(v.visits) || 1)
    let h = byUrl.get(v.url)
    if (h) {
      h.visits = Math.max(h.visits, visits)
      h.lastVisit = Math.max(h.lastVisit, lastVisit)
      if (!h.title && v.title) h.title = v.title
    } else {
      h = { url: v.url, lastVisit, visits, ...(v.title ? { title: v.title } : {}) }
      doc.history.push(h)
      byUrl.set(v.url, h)
    }
    touched.add(h)
  }
  doc.history.sort((a, b) => b.lastVisit - a.lastVisit)
  if (doc.history.length > MAX_HISTORY) doc.history.length = MAX_HISTORY
  return doc.history.reduce((n, h) => n + (touched.has(h) ? 1 : 0), 0)
}
