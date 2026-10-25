// Firefox: bookmarks and history both live in places.sqlite (moz_bookmarks + moz_places).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { WEB_URL_SQL, hasColumn, num, str, withDbCopy } from './sqlite'
import type { BookmarkNode, BookmarkRoot, ImportedVisit } from './types'

const TYPE_BOOKMARK = 1
const TYPE_FOLDER = 2

// Fixed GUIDs of the built-in roots. The tags root is skipped: tags are not folders to a user.
const ROOTS: [guid: string, root: BookmarkRoot, title: string][] = [
  ['toolbar_____', 'toolbar', 'Bookmarks Toolbar'],
  ['menu________', 'menu', 'Bookmarks Menu'],
  ['unfiled_____', 'unfiled', 'Other Bookmarks'],
  ['mobile______', 'mobile', 'Mobile Bookmarks']
]

export function firefoxBookmarksFromDb(db: DatabaseSync): BookmarkNode[] {
  const rows = db
    .prepare(
      `SELECT b.id, b.type, b.parent, b.title, b.guid, b.dateAdded / 1000 AS added, p.url
       FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk
       ORDER BY b.parent, b.position`
    )
    .all()
  const byParent = new Map<number, typeof rows>()
  const byGuid = new Map<string, number>()
  for (const r of rows) {
    const parent = num(r.parent)
    let list = byParent.get(parent)
    if (!list) byParent.set(parent, (list = []))
    list.push(r)
    byGuid.set(str(r.guid), num(r.id))
  }

  const seen = new Set<number>()
  const kids = (id: number, depth: number): BookmarkNode[] => {
    if (depth > 32 || seen.has(id)) return []
    seen.add(id)
    return (byParent.get(id) ?? []).flatMap((r): BookmarkNode[] => {
      const type = num(r.type)
      const addedAt = num(r.added) || undefined
      if (type === TYPE_BOOKMARK) {
        const url = str(r.url)
        // place: URLs are saved searches ("Recently bookmarked" etc.), not pages.
        if (!url || url.startsWith('place:')) return []
        return [{ kind: 'bookmark', title: str(r.title), url, addedAt }]
      }
      if (type === TYPE_FOLDER) return [{ kind: 'folder', title: str(r.title) || 'Folder', addedAt, children: kids(num(r.id), depth + 1) }]
      return [] // separators
    })
  }

  const out: BookmarkNode[] = []
  for (const [guid, root, title] of ROOTS) {
    const id = byGuid.get(guid)
    if (id === undefined) continue
    const children = kids(id, 0)
    if (children.length) out.push({ kind: 'folder', title, root, children })
  }
  return out
}

export function firefoxHistoryFromDb(db: DatabaseSync, limit = 5000): ImportedVisit[] {
  const hidden = hasColumn(db, 'moz_places', 'hidden') ? 'AND hidden = 0' : ''
  const rows = db
    .prepare(
      `SELECT url, title, visit_count AS visits, last_visit_date / 1000 AS last
       FROM moz_places WHERE visit_count > 0 AND last_visit_date > 0 ${hidden} AND ${WEB_URL_SQL}
       ORDER BY last_visit_date DESC LIMIT ?`
    )
    .all(limit)
  return rows.map((r) => ({ url: str(r.url), title: str(r.title) || undefined, visits: Math.max(1, num(r.visits)), lastVisit: num(r.last) }))
}

/** One copy of places.sqlite serves both parts; a failing part becomes a warning, not a lost import. */
export async function readFirefoxPlaces(
  profilePath: string,
  opts: { bookmarks?: boolean; history?: boolean; limit?: number } = {}
): Promise<{ bookmarks: BookmarkNode[]; history: ImportedVisit[]; warnings: string[] }> {
  const out = { bookmarks: [] as BookmarkNode[], history: [] as ImportedVisit[], warnings: [] as string[] }
  const file = join(profilePath, 'places.sqlite')
  if (!existsSync(file)) return out
  await withDbCopy(file, (db) => {
    if (opts.bookmarks !== false) {
      try {
        out.bookmarks = firefoxBookmarksFromDb(db)
      } catch (e) {
        out.warnings.push(`Bookmarks: ${(e as Error).message}`)
      }
    }
    if (opts.history !== false) {
      try {
        out.history = firefoxHistoryFromDb(db, opts.limit)
      } catch (e) {
        out.warnings.push(`History: ${(e as Error).message}`)
      }
    }
  })
  return out
}
