// Chromium family (Chrome, Edge, Brave): the Bookmarks JSON file and the History SQLite database.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { WEB_URL_SQL, hasColumn, num, str, withDbCopy } from './sqlite'
import { type BookmarkNode, type BookmarkRoot, type ImportedVisit, ImportError } from './types'

// WebKit time: microseconds since 1601-01-01 UTC. The raw values pass 2^53, so divide before JS sees them.
const WEBKIT_EPOCH_MS = 11644473600000

export function webkitToMs(v: unknown): number | undefined {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n / 1000 - WEBKIT_EPOCH_MS)
}

const ROOTS: [key: string, root: BookmarkRoot, title: string][] = [
  ['bookmark_bar', 'toolbar', 'Bookmarks bar'],
  ['other', 'other', 'Other bookmarks'],
  ['synced', 'mobile', 'Mobile bookmarks']
]

/** Parses the profile's `Bookmarks` JSON into root folders (empty roots dropped). Pure. */
export function parseChromiumBookmarks(json: unknown): BookmarkNode[] {
  const roots = (json as any)?.roots
  if (!roots || typeof roots !== 'object') throw new ImportError('This does not look like a Chromium Bookmarks file (no roots).')

  const kids = (n: any, depth: number): BookmarkNode[] =>
    (Array.isArray(n?.children) ? n.children : []).flatMap((c: unknown) => walk(c, depth + 1))

  const walk = (n: any, depth: number): BookmarkNode[] => {
    if (!n || typeof n !== 'object' || depth > 32) return []
    if (n.type === 'url') {
      if (typeof n.url !== 'string' || !n.url) return []
      return [{ kind: 'bookmark', title: str(n.name), url: n.url, addedAt: webkitToMs(n.date_added) }]
    }
    if (n.type === 'folder' || Array.isArray(n.children)) return [{ kind: 'folder', title: str(n.name) || 'Folder', addedAt: webkitToMs(n.date_added), children: kids(n, depth) }]
    return []
  }

  const out: BookmarkNode[] = []
  for (const [key, root, title] of ROOTS) {
    const children = kids(roots[key], 0)
    // Edge names its roots "Favorites bar" etc.; keep the browser's own name when it has one.
    if (children.length) out.push({ kind: 'folder', title: str(roots[key]?.name) || title, root, children })
  }
  return out
}

export async function readChromiumBookmarks(profilePath: string): Promise<BookmarkNode[]> {
  const file = join(profilePath, 'Bookmarks')
  if (!existsSync(file)) return []
  let json: unknown
  try {
    json = JSON.parse(await readFile(file, 'utf-8'))
  } catch {
    throw new ImportError('The Bookmarks file could not be read.')
  }
  return parseChromiumBookmarks(json)
}

/** Most recent pages first, from the `urls` table. */
export function chromiumHistoryFromDb(db: DatabaseSync, limit = 5000): ImportedVisit[] {
  const hidden = hasColumn(db, 'urls', 'hidden') ? 'AND hidden = 0' : ''
  const rows = db
    .prepare(
      `SELECT url, title, visit_count AS visits, (last_visit_time / 1000 - ${WEBKIT_EPOCH_MS}) AS last
       FROM urls WHERE last_visit_time > 0 ${hidden} AND ${WEB_URL_SQL}
       ORDER BY last_visit_time DESC LIMIT ?`
    )
    .all(limit)
  return rows.map((r) => ({ url: str(r.url), title: str(r.title) || undefined, visits: Math.max(1, num(r.visits)), lastVisit: num(r.last) }))
}

export async function readChromiumHistory(profilePath: string, limit = 5000): Promise<ImportedVisit[]> {
  const file = join(profilePath, 'History')
  if (!existsSync(file)) return []
  return withDbCopy(file, (db) => chromiumHistoryFromDb(db, limit))
}
