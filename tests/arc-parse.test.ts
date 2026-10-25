import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ArcFormatError, countNodes, parseArcSidebar } from '../src/main/arc-parse'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/arc-sidebar.json', import.meta.url), 'utf-8'))

describe('parseArcSidebar', () => {
  const plan = parseArcSidebar(fixture)

  it('reads spaces in order with emoji, colour and profile', () => {
    expect(plan.spaces.map((s) => s.title)).toEqual(['Work', 'Fun'])
    expect(plan.spaces[0].emoji).toBe('💼')
    expect(plan.spaces[0].color).toBe('#3366cc') // 0-1 components
    expect(plan.spaces[1].color).toBe('#ff8000') // 0-255 components
    expect(plan.spaces[0].profile).toBe('default')
    expect(plan.spaces[1].profile).toMatch(/^custom:/)
  })

  it('keeps pinned folders nested and prefers the user rename', () => {
    const [doc, research] = plan.spaces[0].pinned
    expect(doc).toEqual({ kind: 'tab', url: 'https://docs.example.com/a', title: 'My doc' })
    expect(research.kind).toBe('folder')
    expect(research.title).toBe('Research')
    expect(research.children?.[1].children?.[0].url).toBe('https://news.example.net/')
    expect(countNodes(plan.spaces[0].pinned)).toEqual({ tabs: 3, folders: 2 })
  })

  it('maps unpinned to today and skips missing ids', () => {
    expect(plan.spaces[0].today.map((n) => n.title)).toEqual(['Shop'])
    expect(plan.spaces[1].pinned).toEqual([])
    expect(plan.spaces[1].today.map((n) => n.url)).toEqual(['https://video.example.com/'])
  })

  it('reads favorites', () => {
    expect(plan.favorites.map((n) => n.title)).toEqual(['Mail', 'Calendar'])
  })

  it('rejects other files and newer versions', () => {
    expect(() => parseArcSidebar({ foo: 1 })).toThrow(ArcFormatError)
    expect(() => parseArcSidebar({ ...fixture, version: 2 })).toThrow(/newer/)
  })
})

describe('Arc emoji to icons', async () => {
  const { iconFromEmoji } = await import('../src/shared/icons')
  const { applyArcPlan } = await import('../src/main/arc-import')
  const { freshDoc } = await import('../src/main/store')
  it('maps known emoji and falls back to defaults', () => {
    expect(iconFromEmoji('💼')).toBe('briefcase')
    expect(iconFromEmoji('🎮')).toBe('gamepad')
    expect(iconFromEmoji('✈')).toBe('plane') // without the variation selector
    expect(iconFromEmoji('🐼', 1)).toBe('briefcase') // unknown -> DEFAULT_SPACE_ICONS[1]
  })
  it('imported spaces carry icons, never emoji', () => {
    const doc = freshDoc()
    applyArcPlan(doc, parseArcSidebar(fixture), { includeToday: true })
    expect(doc.spaces.map((s) => s.icon)).toEqual(['house', 'briefcase', 'gamepad'])
    expect(JSON.stringify(doc.spaces)).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
