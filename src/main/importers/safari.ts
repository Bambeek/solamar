// Safari (macOS): ~/Library/Safari/Bookmarks.plist (binary plist) and History.db (SQLite).
// Reading ~/Library/Safari needs Full Disk Access for the app; without it opening fails with EPERM.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { parseBplist } from './bplist'
import { num, str, withDbCopy } from './sqlite'
import { type BookmarkNode, type BookmarkRoot, type ImportedVisit, ImportError } from './types'

const APPLE_EPOCH_S = 978307200 // 2001-01-01 UTC

type Plist = Record<string, unknown>

const ROOTS: Record<string, [BookmarkRoot, string]> = {
  BookmarksBar: ['toolbar', 'Favorites'],
  BookmarksMenu: ['menu', 'Bookmarks Menu'],
  'com.apple.ReadingList': ['reading', 'Reading List']
}

const isDict = (v: unknown): v is Plist => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)

/** Bookmarks.plist (already decoded) into root folders. Pure. */
export function parseSafariBookmarks(plist: unknown): BookmarkNode[] {
  if (!isDict(plist) || !Array.isArray(plist.Children)) throw new ImportError('This does not look like a Safari Bookmarks.plist (no Children).')

  const walk = (n: unknown, depth: number): BookmarkNode[] => {
    if (!isDict(n) || depth > 32) return []
    const type = n.WebBookmarkType
    if (type === 'WebBookmarkTypeLeaf') {
      const url = str(n.URLString)
      if (!url) return []
      const title = isDict(n.URIDictionary) ? str(n.URIDictionary.title) : ''
      return [{ kind: 'bookmark', title, url }]
    }
    if (type === 'WebBookmarkTypeList') return [{ kind: 'folder', title: str(n.Title) || 'Folder', children: kids(n, depth) }]
    return [] // WebBookmarkTypeProxy is the built-in History entry
  }
  const kids = (n: Plist, depth: number) => (Array.isArray(n.Children) ? n.Children : []).flatMap((c) => walk(c, depth + 1))

  const out: BookmarkNode[] = []
  const loose: BookmarkNode[] = [] // items saved at the top of the Bookmarks sidebar
  for (const c of plist.Children) {
    const known = isDict(c) ? ROOTS[str(c.Title)] : undefined
    if (known && isDict(c)) {
      const children = kids(c, 0)
      if (children.length) out.push({ kind: 'folder', title: known[1], root: known[0], children })
    } else loose.push(...walk(c, 0))
  }
  if (loose.length) out.push({ kind: 'folder', title: 'Bookmarks', root: 'other', children: loose })
  // Toolbar first, reading list last, like the other browsers.
  const order: BookmarkRoot[] = ['toolbar', 'menu', 'other', 'reading']
  return out.sort((a, b) => order.indexOf(a.root!) - order.indexOf(b.root!))
}

export async function readSafariBookmarks(safariDir: string): Promise<BookmarkNode[]> {
  const file = join(safariDir, 'Bookmarks.plist')
  if (!existsSync(file)) return []
  let buf: Uint8Array
  try {
    buf = await readFile(file)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    throw new ImportError(code === 'EPERM' || code === 'EACCES' ? 'Solamar needs Full Disk Access to read Safari bookmarks.' : 'Safari bookmarks could not be read.')
  }
  return parseSafariBookmarks(parseBplist(buf))
}

/** history_items holds the URL and count; history_visits holds each visit (seconds since 2001) and its title. */
export function safariHistoryFromDb(db: DatabaseSync, limit = 5000): ImportedVisit[] {
  const rows = db
    .prepare(
      `SELECT i.url AS url, i.visit_count AS visits, MAX(v.visit_time) AS t,
         (SELECT v2.title FROM history_visits v2 WHERE v2.history_item = i.id AND v2.title IS NOT NULL AND v2.title != ''
          ORDER BY v2.visit_time DESC LIMIT 1) AS title
       FROM history_items i JOIN history_visits v ON v.history_item = i.id
       WHERE (i.url LIKE 'http://%' OR i.url LIKE 'https://%')
       GROUP BY i.id ORDER BY t DESC LIMIT ?`
    )
    .all(limit)
  return rows.map((r) => ({
    url: str(r.url),
    title: str(r.title) || undefined,
    visits: Math.max(1, num(r.visits)),
    lastVisit: Math.round((num(r.t) + APPLE_EPOCH_S) * 1000)
  }))
}

export async function readSafariHistory(safariDir: string, limit = 5000): Promise<ImportedVisit[]> {
  const file = join(safariDir, 'History.db')
  if (!existsSync(file)) return []
  try {
    return await withDbCopy(file, (db) => safariHistoryFromDb(db, limit))
  } catch (e) {
    const code = (e as Error).message.match(/\((EPERM|EACCES)\)/)
    if (code) throw new ImportError('Solamar needs Full Disk Access to read Safari history.')
    throw e
  }
}
