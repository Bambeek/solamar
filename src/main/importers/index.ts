// Entry point for the IPC layer: list sources, read one, then applyImport() it into the Doc.
import { readChromiumBookmarks, readChromiumHistory } from './chromium'
import { readFirefoxPlaces } from './firefox'
import { readSafariBookmarks, readSafariHistory } from './safari'
import type { ImportData, ImportSource } from './types'

export { applyImport, type ApplyOptions, type ApplyResult } from './apply'
export { listSources } from './locate'
export { parsePasswordsCsv, type PasswordCsvResult, type PasswordEntry } from './passwords-csv'
export { countBookmarks, type ImportData, type ImportSource } from './types'

export interface ReadOptions {
  bookmarks?: boolean // default true
  history?: boolean // default true
  historyLimit?: number // most recent pages to read, default 5000
}

/** Reads one profile. Never throws for a single failing part: that part is empty and a warning says why. */
export async function readSource(src: ImportSource, opts: ReadOptions = {}): Promise<ImportData> {
  const wantBookmarks = opts.bookmarks !== false && src.has.bookmarks
  const wantHistory = opts.history !== false && src.has.history
  const limit = opts.historyLimit ?? 5000
  const data: ImportData = { browser: src.browser, bookmarks: [], history: [], warnings: [] }
  const part = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      data.warnings.push(`${label}: ${(e as Error).message}`)
      return fallback
    }
  }

  if (src.browser === 'firefox') {
    if (!wantBookmarks && !wantHistory) return data
    const r = await part('Firefox', () => readFirefoxPlaces(src.profilePath, { bookmarks: wantBookmarks, history: wantHistory, limit }), null)
    if (r) Object.assign(data, { bookmarks: r.bookmarks, history: r.history, warnings: [...data.warnings, ...r.warnings] })
    return data
  }
  const [readBookmarks, readHistory] = src.browser === 'safari' ? [readSafariBookmarks, readSafariHistory] : [readChromiumBookmarks, readChromiumHistory]
  if (wantBookmarks) data.bookmarks = await part('Bookmarks', () => readBookmarks(src.profilePath), [])
  if (wantHistory) data.history = await part('History', () => readHistory(src.profilePath, limit), [])
  return data
}
