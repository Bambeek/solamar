import { describe, expect, it } from 'vitest'
import { isLocalHost, parseTidy } from '../src/main/ai'
import { matchScore, rankResults, tabsToArchive, tabsToSleep } from '../src/main/policy'
import type { Item, TabRuntime } from '../src/shared/types'

const H = 3_600_000
const tab = (id: string, section: Item['section'], lastActiveAt: number, url = 'https://' + id + '.com/'): Item =>
  ({ id, spaceId: 's', parentId: null, kind: 'tab', section, url, title: id, position: 0, createdAt: 0, lastActiveAt })
const rt = (awake: boolean, audible = false): TabRuntime => ({ awake, audible, loading: false, canGoBack: false, canGoForward: false, blocked: 0, zoom: 1 })

describe('sleep and archive', () => {
  const now = 100 * H
  const items = [tab('old', 'today', now - 13 * H), tab('new', 'today', now - 1 * H), tab('pin', 'pinned', now - 50 * H), tab('loud', 'today', now - 20 * H), tab('shown', 'today', now - 20 * H)]
  const runtime = { old: rt(true), new: rt(true), pin: rt(true), loud: rt(true, true), shown: rt(true) }
  const visible = new Set(['shown'])

  it('archives only idle, hidden, silent today tabs', () => {
    expect(tabsToArchive(items, visible, now, 12, runtime)).toEqual(['old'])
    expect(tabsToArchive(items, visible, now, 0, runtime)).toEqual([])
  })
  it('sleeps idle hidden tabs of any section but not audible or visible ones', () => {
    expect(tabsToSleep(items, runtime, visible, now, 30).sort()).toEqual(['new', 'old', 'pin'])
    expect(tabsToSleep(items, runtime, visible, now, 0)).toEqual([])
  })
})

describe('command bar ranking', () => {
  it('scores prefix over word over substring', () => {
    expect(matchScore('git', 'github.com')).toBeGreaterThan(matchScore('hub', 'github.com'))
    expect(matchScore('docs', 'Google Docs')).toBeGreaterThan(matchScore('oog', 'Google Docs'))
    expect(matchScore('zzz', 'Google Docs')).toBe(0)
  })
  it('puts the navigate row first and open tabs above history', () => {
    const r = rankResults('gi', [tab('github', 'today', 0)], [{ url: 'https://gitlab.com/', title: 'GitLab', lastVisit: 0, visits: 1 }], [], { id: 'nav', kind: 'search', title: 'gi', score: 1000 })
    expect(r.map((x) => x.kind)).toEqual(['search', 'tab', 'history'])
  })
})

describe('local AI helpers', () => {
  it('accepts only loopback hosts', () => {
    expect(isLocalHost('http://127.0.0.1:11434')).toBe(true)
    expect(isLocalHost('http://localhost:11434')).toBe(true)
    expect(isLocalHost('https://api.example.com')).toBe(false)
    expect(isLocalHost('not a url')).toBe(false)
  })
  it('parses tidy answers defensively', () => {
    expect(parseTidy('{"groups":[{"title":"A","tabs":[1,2,2,9]},{"title":"B","tabs":[2,3]}]}', 3)).toEqual([
      { title: 'A', tabs: [1, 2] },
      { title: 'B', tabs: [3] }
    ])
    expect(parseTidy('Sure! {"groups":[{"title":"X","tabs":[1]}]} hope it helps', 1)).toEqual([{ title: 'X', tabs: [1] }])
    expect(parseTidy('nonsense', 3)).toEqual([])
  })
})
