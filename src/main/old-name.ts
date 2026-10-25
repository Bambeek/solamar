// Solamar was called Harbor while it was being built. What that name left on this computer moves over once: the
// profile folder (tabs, history, passwords, extensions, cookies), the settings file in it and the clips folder.
// Anything that cannot move (Harbor still running, a folder open in Explorer) is used where it is, or tried again
// at the next start.
import { existsSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

export const OLD_NAME = 'Harbor'

/**
 * Before anything opens the profile: moves %APPDATA%\Harbor to Solamar's profile folder, or keeps using it.
 * Electron makes the profile folder (empty) before the main script runs, so a profile counts by its settings file.
 */
export function moveOldProfile(): void {
  const now = app.getPath('userData')
  const old = join(app.getPath('appData'), OLD_NAME)
  if (existsSync(join(now, 'solamar.json')) || !existsSync(join(old, 'harbor.json'))) return
  try {
    if (existsSync(now)) {
      try {
        rmdirSync(now) // the empty folder Electron made; fails if anything is in it
      } catch {
        renameSync(now, `${now} (unused ${Date.now()})`) // a fresh profile with no settings: kept aside, not deleted
      }
    }
    renameSync(old, now)
  } catch (err) {
    console.error('[solamar] could not move the Harbor profile yet, using it where it is', err)
    app.setPath('userData', old)
  }
}

/** The settings file in the profile: solamar.json, which was harbor.json. */
export function settingsFile(dir: string): string {
  const file = join(dir, 'solamar.json')
  const old = join(dir, 'harbor.json')
  if (existsSync(file) || !existsSync(old)) return file
  try {
    renameSync(old, file)
    return file
  } catch {
    return old
  }
}

/** Documents\Harbor Clips becomes the default clips folder; index.json then points at the moved folders. */
export function moveOldClips(root: string): void {
  const old = join(dirname(root), `${OLD_NAME} Clips`)
  if (existsSync(root) || !existsSync(old)) return
  try {
    renameSync(old, root)
  } catch {
    return
  }
  const index = join(root, 'index.json')
  try {
    const list = JSON.parse(readFileSync(index, 'utf-8'))
    if (!Array.isArray(list)) return
    const moved = list.map((c) => (c && typeof c.dir === 'string' && c.dir.startsWith(old) ? { ...c, dir: root + c.dir.slice(old.length) } : c))
    writeFileSync(index, JSON.stringify(moved, null, 2))
  } catch {
    // No index yet: nothing points at the old folder.
  }
}
