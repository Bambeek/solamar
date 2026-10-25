import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const paths: Record<string, string> = {}
vi.mock('electron', () => ({
  app: {
    getPath: (n: string) => paths[n],
    setPath: (n: string, p: string) => void (paths[n] = p)
  }
}))
const { moveOldClips, moveOldProfile, settingsFile } = await import('../src/main/old-name')

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'old-name-'))
  paths.appData = base
  paths.userData = join(base, 'Solamar')
})

describe('moveOldProfile', () => {
  it('moves the Harbor profile folder to Solamar', () => {
    mkdirSync(join(base, 'Harbor'))
    writeFileSync(join(base, 'Harbor', 'harbor.json'), '{}')
    mkdirSync(join(base, 'Solamar')) // Electron makes it, empty, before the main script runs
    moveOldProfile()
    expect(existsSync(join(base, 'Solamar', 'harbor.json'))).toBe(true)
    expect(existsSync(join(base, 'Harbor'))).toBe(false)
    expect(paths.userData).toBe(join(base, 'Solamar'))
  })

  it('sets aside a Solamar folder that has no settings yet', () => {
    mkdirSync(join(base, 'Harbor'))
    writeFileSync(join(base, 'Harbor', 'harbor.json'), '{"old":1}')
    mkdirSync(join(base, 'Solamar'))
    writeFileSync(join(base, 'Solamar', 'session.json'), '{}')
    moveOldProfile()
    expect(readFileSync(join(base, 'Solamar', 'harbor.json'), 'utf-8')).toBe('{"old":1}')
    expect(readdirSync(base).some((n) => n.startsWith('Solamar (unused '))).toBe(true)
  })

  it('leaves an existing Solamar profile alone', () => {
    mkdirSync(join(base, 'Harbor'))
    writeFileSync(join(base, 'Harbor', 'harbor.json'), '{}')
    mkdirSync(join(base, 'Solamar'))
    writeFileSync(join(base, 'Solamar', 'solamar.json'), '{}')
    moveOldProfile()
    expect(existsSync(join(base, 'Harbor'))).toBe(true)
    expect(paths.userData).toBe(join(base, 'Solamar'))
  })
})

describe('settingsFile', () => {
  it('renames harbor.json to solamar.json once', () => {
    writeFileSync(join(base, 'harbor.json'), '{"a":1}')
    expect(settingsFile(base)).toBe(join(base, 'solamar.json'))
    expect(readFileSync(join(base, 'solamar.json'), 'utf-8')).toBe('{"a":1}')
    expect(existsSync(join(base, 'harbor.json'))).toBe(false)
  })

  it('prefers solamar.json when both exist', () => {
    writeFileSync(join(base, 'harbor.json'), 'old')
    writeFileSync(join(base, 'solamar.json'), 'new')
    expect(settingsFile(base)).toBe(join(base, 'solamar.json'))
    expect(readFileSync(join(base, 'harbor.json'), 'utf-8')).toBe('old')
  })
})

describe('moveOldClips', () => {
  it('moves Harbor Clips and points index.json at the new folders', () => {
    const old = join(base, 'Harbor Clips')
    const root = join(base, 'Solamar Clips')
    mkdirSync(join(old, '2026-10-25-example-com-page'), { recursive: true })
    writeFileSync(join(old, 'index.json'), JSON.stringify([{ dir: join(old, '2026-10-25-example-com-page'), url: 'https://example.com/', title: 'Page', savedAt: '' }, { dir: 'C:\\elsewhere' }]))
    moveOldClips(root)
    const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf-8'))
    expect(index[0].dir).toBe(join(root, '2026-10-25-example-com-page'))
    expect(index[1].dir).toBe('C:\\elsewhere')
    expect(existsSync(old)).toBe(false)
  })
})
