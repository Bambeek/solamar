// Opens another browser's SQLite file safely: the live file is only ever copied, never opened.
// Browsers keep these databases open (and recent writes sit in the -wal file), so we copy both to a
// temp folder and read the copy.
import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ImportError } from './types'

export async function withDbCopy<T>(file: string, fn: (db: DatabaseSync) => T): Promise<T> {
  if (!existsSync(file)) throw new ImportError(`${basename(file)} not found`)
  const dir = await mkdtemp(join(tmpdir(), 'solamar-import-'))
  const copy = join(dir, basename(file))
  try {
    try {
      await copyFile(file, copy)
      for (const ext of ['-wal', '-journal']) if (existsSync(file + ext)) await copyFile(file + ext, copy + ext)
    } catch (e) {
      throw new ImportError(`Could not copy ${basename(file)} (${(e as NodeJS.ErrnoException).code ?? 'error'}). Close the browser and try again.`)
    }
    // A non-empty rollback journal means a write was in flight: SQLite must roll it back, which a
    // read-only handle cannot do. It is our private copy, so a writable handle is safe there.
    const hotJournal = existsSync(copy + '-journal') && statSync(copy + '-journal').size > 0
    const db = new DatabaseSync(copy, { readOnly: !hotJournal })
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === column)
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export function num(v: unknown): number {
  const n = typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Only web pages make sense in Solamar's history; the SQL filters keep LIMIT honest. */
export const WEB_URL_SQL = "(url LIKE 'http://%' OR url LIKE 'https://%')"
