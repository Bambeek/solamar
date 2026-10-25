// Shapes shared by the browser importers. Readers produce ImportData; apply.ts merges it into the Doc.

export type BrowserId = 'chrome' | 'edge' | 'brave' | 'firefox' | 'safari'

export const BROWSER_NAMES: Record<BrowserId, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  brave: 'Brave',
  firefox: 'Firefox',
  safari: 'Safari'
}

export interface ImportSource {
  browser: BrowserId
  browserName: string
  profileName: string
  profilePath: string
  isDefault: boolean
  has: { bookmarks: boolean; history: boolean }
  needsPermission?: boolean // files exist but cannot be opened (Safari without Full Disk Access)
}

/** Where a top-level folder came from, so apply.ts can lay roots out (the toolbar goes to the top level). */
export type BookmarkRoot = 'toolbar' | 'other' | 'mobile' | 'menu' | 'unfiled' | 'reading'

export interface BookmarkNode {
  kind: 'bookmark' | 'folder'
  title: string
  url?: string
  addedAt?: number // ms since epoch
  root?: BookmarkRoot
  children?: BookmarkNode[]
}

export interface ImportedVisit {
  url: string
  title?: string
  visits: number
  lastVisit: number // ms since epoch
}

export interface ImportData {
  browser?: BrowserId
  bookmarks: BookmarkNode[]
  history: ImportedVisit[]
  warnings: string[] // one part failed (e.g. history locked) while the rest was read
}

export class ImportError extends Error {}

export function countBookmarks(nodes: BookmarkNode[]): { bookmarks: number; folders: number } {
  let bookmarks = 0
  let folders = 0
  const visit = (n: BookmarkNode) => {
    if (n.kind === 'bookmark') bookmarks++
    else {
      if (!n.root) folders++
      n.children?.forEach(visit)
    }
  }
  nodes.forEach(visit)
  return { bookmarks, folders }
}
