// Per-tab back/forward history and page state (scroll position, typed form values) kept in session.json,
// so tabs come back where they were after a crash or restart. Private spaces are never written here.
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import type { NavigationEntry } from 'electron'

export interface TabSession {
  index: number
  entries: NavigationEntry[]
}

const MAX_ENTRIES = 30 // per tab, newest kept

export class SessionState {
  private tabs: Record<string, TabSession> = {}
  readonly crashed: boolean

  constructor(private readonly file: string, private readonly lockFile: string) {
    try {
      if (existsSync(file)) this.tabs = JSON.parse(readFileSync(file, 'utf-8'))
    } catch {
      this.tabs = {}
    }
    // The lock exists while Solamar runs and is removed on a clean quit; finding it means the last run did not end well.
    this.crashed = existsSync(lockFile)
    writeFileSync(lockFile, String(process.pid))
  }

  get(id: string): TabSession | undefined {
    return this.tabs[id]
  }

  set(id: string, s: TabSession): void {
    if (!s.entries.length) return
    const start = Math.max(0, s.entries.length - MAX_ENTRIES)
    this.tabs[id] = { index: Math.max(0, s.index - start), entries: s.entries.slice(start) }
  }

  forget(id: string): void {
    delete this.tabs[id]
  }

  /** Writes the state for tabs that still exist. */
  save(liveIds: Set<string>): void {
    for (const id of Object.keys(this.tabs)) if (!liveIds.has(id)) delete this.tabs[id]
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.tabs))
    renameSync(tmp, this.file)
  }

  /** Clean quit: no crash notice next time. */
  close(liveIds: Set<string>): void {
    this.save(liveIds)
    try {
      unlinkSync(this.lockFile)
    } catch {}
  }
}
