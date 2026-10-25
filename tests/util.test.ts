import { describe, expect, it } from 'vitest'
import { accelerator, boostCss, boostMatches, contrast, frameColors, isEmptyBoost, normalizeAccelerator, toNavigable } from '../src/shared/util'

describe('toNavigable', () => {
  it('keeps URLs, adds https to hosts, searches the rest', () => {
    expect(toNavigable('https://a.com/x', 'duckduckgo').url).toBe('https://a.com/x')
    expect(toNavigable('example.com', 'duckduckgo').url).toBe('https://example.com')
    expect(toNavigable('example.com:8080/x', 'duckduckgo').url).toBe('https://example.com:8080/x')
    expect(toNavigable('localhost:3000', 'duckduckgo').url).toBe('http://localhost:3000')
    expect(toNavigable('how to cook rice', 'google')).toEqual({ url: 'https://www.google.com/search?q=how%20to%20cook%20rice', isSearch: true })
    expect(toNavigable('arc', 'duckduckgo').isSearch).toBe(true)
  })
})

describe('shortcuts', () => {
  const k = (code: string, m: Partial<{ control: boolean; shift: boolean; alt: boolean }> = {}) =>
    ({ key: '', code, control: false, shift: false, alt: false, meta: false, ...m })
  it('builds layout-independent accelerators', () => {
    expect(accelerator(k('KeyT', { control: true, shift: true }))).toBe('Ctrl+Shift+T')
    expect(accelerator(k('Digit1', { alt: true }))).toBe('Alt+1')
    expect(accelerator(k('ArrowLeft', { alt: true }))).toBe('Alt+Left')
    expect(accelerator(k('Comma', { control: true }))).toBe('Ctrl+,')
    expect(accelerator(k('ShiftLeft', { shift: true }))).toBe('')
  })
  it('normalises typed accelerators', () => {
    expect(normalizeAccelerator('shift+ctrl+t')).toBe('Ctrl+Shift+T')
    expect(normalizeAccelerator('Ctrl+')).toBe('')
  })
})

describe('frameColors', () => {
  it('keeps sidebar text readable on every preset-like colour', () => {
    for (const color of ['#7c6cf2', '#f59e0b', '#10b981', '#1e1b4b', '#f5f5f4', '#ef4444'])
      for (const dark of [false, true]) {
        const f = frameColors({ color, mode: 'auto', texture: 'none', intensity: 1 }, dark)
        const text = f.darkText ? '#17151f' : '#f6f5fa'
        expect(Math.min(contrast(text, f.from), contrast(text, f.to))).toBeGreaterThanOrEqual(4.5)
      }
  })
})

describe('boosts', () => {
  const empty = { id: 'b', domain: 'example.com', css: '', js: '', enabled: true, zaps: [] as string[], font: '', filter: 'none' as const, hue: 0 }

  it('matches the site and its subdomains only', () => {
    expect(boostMatches('example.com', 'example.com')).toBe(true)
    expect(boostMatches('example.com', 'news.example.com')).toBe(true)
    expect(boostMatches('example.com', 'notexample.com')).toBe(false)
    expect(boostMatches('', 'example.com')).toBe(false)
  })

  it('writes each zap as its own rule and skips selectors that could break out', () => {
    const css = boostCss({ ...empty, zaps: ['#ad', '.x > p', 'a { color: red } b'] })
    expect(css).toContain('#ad { display: none !important; }')
    expect(css).toContain('.x > p { display: none !important; }')
    expect(css).not.toContain('color: red')
  })

  it('tints the page but turns pictures back', () => {
    const css = boostCss({ ...empty, filter: 'dark', hue: 40 })
    expect(css).toMatch(/html \{ filter: invert\(0\.9\) hue-rotate\(180deg\) hue-rotate\(40deg\)/)
    expect(css).toMatch(/img, video.*\{ filter: invert\(1\) hue-rotate\(180deg\) hue-rotate\(-40deg\)/)
  })

  it('changes the font but keeps code and icon fonts', () => {
    const css = boostCss({ ...empty, font: 'serif' })
    expect(css).toContain('Georgia')
    expect(css).toContain(':not(code)')
    expect(css).toContain(':not([class*="icon"])')
    expect(boostCss({ ...empty, font: 'nope' })).toBe('')
  })

  it('knows an untouched boost', () => {
    expect(isEmptyBoost(empty)).toBe(true)
    expect(isEmptyBoost({ ...empty, hue: 10 })).toBe(false)
    expect(isEmptyBoost({ ...empty, js: 'x()' })).toBe(false)
  })
})
