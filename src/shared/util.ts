// Pure helpers used by both processes (and unit tests).
import { BOOST_FONTS, SEARCH_ENGINES } from './defaults'
import type { Boost, SearchEngine, SpaceTheme } from './types'

// ---------- URLs ----------

const HOSTLIKE = /^(localhost|\[[0-9a-f:]+\]|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?(\/.*)?$/i

/** Turns what the user typed into a URL to load: a URL as-is, a host with https://, anything else a search. */
export function toNavigable(input: string, engine: SearchEngine): { url: string; isSearch: boolean } {
  const text = input.trim()
  if (!text) return { url: 'about:blank', isSearch: false }
  if (/^(https?|file|about|chrome|data):/i.test(text) && !/\s/.test(text)) return { url: text, isSearch: false }
  if (!/\s/.test(text) && HOSTLIKE.test(text)) {
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/i.test(text)
    return { url: (local ? 'http://' : 'https://') + text, isSearch: false }
  }
  return { url: searchUrl(text, engine), isSearch: true }
}

/** Natural-language input (worth an AI rewrite or answer) rather than an address or a single keyword. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim()
  if (!t || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(t)) return false
  return t.split(/\s+/).length >= 3 || /\?$/.test(t)
}

export function searchUrl(query: string, engine: SearchEngine): string {
  const tpl = (SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.duckduckgo).url
  return tpl.replace('%s', encodeURIComponent(query))
}

export function hostOf(url?: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') || u.protocol.replace(':', '')
  } catch {
    return url
  }
}

/** Domain used for per-site settings (ad block allowlist, boosts). */
export function siteOf(url?: string): string {
  return hostOf(url).toLowerCase()
}

// ---------- Colours ----------

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return [124, 108, 242]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}

export function luminance(hex: string): number {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

/** Colours for the window frame of a space: background stops and whether text on it should be dark or light. */
export function frameColors(theme: SpaceTheme, systemDark: boolean) {
  const mode = theme.mode === 'auto' ? (systemDark ? 'dark' : 'light') : theme.mode
  const base = mode === 'dark' ? '#121118' : '#f6f5fa'
  const t = Math.max(0, Math.min(1, theme.intensity))
  const text = mode === 'dark' ? '#f6f5fa' : '#17151f'
  // Pull each stop back towards the base until sidebar text keeps AA contrast (4.5:1) on it.
  const readable = (c: string) => {
    for (let i = 0; i < 20 && contrast(text, c) < 4.6; i++) c = mix(c, base, 0.15)
    return c
  }
  const from = readable(mix(base, theme.color, mode === 'dark' ? t * 0.55 : t * 0.45))
  const to = readable(mix(base, theme.color2 ?? theme.color, mode === 'dark' ? t * 0.4 : t * 0.3))
  return { mode, from, to, darkText: mode !== 'dark' }
}

// ---------- Ids, ordering ----------

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ---------- Shortcuts ----------

export interface KeyInput {
  key: string
  code: string
  control: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

const CODE_NAMES: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', Tab: 'Tab', Enter: 'Enter',
  Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete', ArrowLeft: 'Left', ArrowRight: 'Right',
  ArrowUp: 'Up', ArrowDown: 'Down', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  NumpadAdd: '=', NumpadSubtract: '-'
}

/** Layout-independent accelerator string for a key event ("Ctrl+Shift+T"); '' for bare modifiers. */
export function accelerator(i: KeyInput): string {
  let k = ''
  if (/^Key[A-Z]$/.test(i.code)) k = i.code.slice(3)
  else if (/^Digit\d$/.test(i.code)) k = i.code.slice(5)
  else if (/^Numpad\d$/.test(i.code)) k = i.code.slice(6)
  else if (/^F\d{1,2}$/.test(i.code)) k = i.code
  else if (CODE_NAMES[i.code]) k = CODE_NAMES[i.code]
  else if (!i.code && i.key) {
    // Synthetic events may carry no physical code; fall back to the key value.
    const named: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Escape: 'Esc', ' ': 'Space' }
    k = named[i.key] ?? (/^F\d{1,2}$/.test(i.key) || ['Tab', 'Enter', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].includes(i.key) ? i.key : i.key.length === 1 ? i.key.toUpperCase() : '')
  }
  if (!k) return ''
  const mods = [i.control && 'Ctrl', i.meta && 'Meta', i.alt && 'Alt', i.shift && 'Shift'].filter(Boolean)
  return [...mods, k].join('+')
}

/** Normalises user-typed accelerators so "shift+ctrl+t" matches "Ctrl+Shift+T". */
export function normalizeAccelerator(s: string): string {
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean)
  const order = ['Ctrl', 'Meta', 'Alt', 'Shift']
  const alias: Record<string, string> = { control: 'Ctrl', ctrl: 'Ctrl', cmd: 'Meta', meta: 'Meta', win: 'Meta', alt: 'Alt', option: 'Alt', shift: 'Shift' }
  const mods: string[] = []
  let key = ''
  for (const p of parts) {
    const m = alias[p.toLowerCase()]
    if (m) mods.push(m)
    else key = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)
  }
  if (!key) return ''
  return [...order.filter((o) => mods.includes(o)), key].join('+')
}

// ---------- Boosts ----------

/** A boost for `domain` also applies on its subdomains. */
export function boostMatches(domain: string, site: string): boolean {
  return !!domain && (site === domain || site.endsWith('.' + domain))
}

const MEDIA = 'img, video, picture, canvas, iframe, embed, object, [style*="background-image"]'
// Icon fonts and code keep their own font when a boost changes the page font.
const FONT_KEEP = ':not(code):not(pre):not(pre *):not(kbd):not(samp):not(i):not([class*="icon"]):not([class*="Icon"]):not([class*="material-symbols"]):not([class^="fa"]):not([class*=" fa-"])'

/** The CSS a boost puts on a page. Each zap is its own rule, so one bad selector cannot void the others. */
export function boostCss(b: Pick<Boost, 'css' | 'zaps' | 'font' | 'filter' | 'hue'>): string {
  const out: string[] = []
  const hue = Math.round(b.hue) % 360
  const page: string[] = []
  const media: string[] = []
  if (b.filter === 'dark') page.push('invert(0.9)', 'hue-rotate(180deg)'), media.push('invert(1)', 'hue-rotate(180deg)')
  if (b.filter === 'sepia') page.push('sepia(0.55)')
  if (b.filter === 'gray') page.push('grayscale(1)')
  if (hue) page.push(`hue-rotate(${hue}deg)`), media.push(`hue-rotate(${-hue}deg)`)
  if (page.length) out.push(`html { filter: ${page.join(' ')} !important; }`)
  if (media.length) out.push(`${MEDIA} { filter: ${media.join(' ')} !important; }`)
  if (b.filter === 'dark') out.push('html { background: #fff !important; }')
  const stack = BOOST_FONTS.find((f) => f.id && f.id === b.font)?.stack
  if (stack) out.push(`body, body *${FONT_KEEP} { font-family: ${stack} !important; }`)
  for (const z of b.zaps) if (z.trim() && !/[{}]/.test(z)) out.push(`${z} { display: none !important; }`)
  if (b.css.trim()) out.push(b.css)
  return out.join('\n')
}

export function isEmptyBoost(b: Boost): boolean {
  return !b.css.trim() && !b.js.trim() && !b.zaps.length && !b.font && b.filter === 'none' && !b.hue
}

// ---------- Google sign-in ----------

/**
 * Google refuses sign-in from browsers it takes for embedded ones ("This browser or app may not be secure"), and
 * Electron is one even with Chrome's user agent. On Google's sign-in host Solamar presents as Firefox (ESR), which
 * Google supports; other Electron browsers (Min) do the same. Only these hosts: everywhere else stays Chrome.
 */
export const GOOGLE_SIGN_IN_HOSTS = ['accounts.google.com']

export function firefoxUserAgent(platform: string): string {
  const os = /win/i.test(platform) ? 'Windows NT 10.0; Win64; x64' : /mac|darwin/i.test(platform) ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}; rv:140.0) Gecko/20100101 Firefox/140.0`
}

/** The low-entropy client hints Chromium sends by default. */
export const CLIENT_HINT_HEADERS = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']

/** Those headers out of a request that carries them (any case), or null when it has none. */
export function clientHintsOf(headers: Record<string, string>): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) if (CLIENT_HINT_HEADERS.includes(k.toLowerCase())) out[k.toLowerCase()] = v
  return out['sec-ch-ua'] ? out : null
}

/** Chromium sends client hints only to potentially trustworthy origins: https, and http on the local machine. */
export function sendsClientHints(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
  } catch {
    return false
  }
}
