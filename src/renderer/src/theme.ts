import type { Space, SpaceTheme } from '@shared/types'
import { contrast, frameColors, mix } from '@shared/util'

// Our own textures, generated in CSS (no image assets).
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"
const DOTS = 'radial-gradient(rgba(0,0,0,.09) 1px, transparent 1.2px)'

export function themeVars(theme: SpaceTheme, systemDark: boolean, layout: 'bar' | 'sidebar' = 'sidebar'): Record<string, string> {
  const f = frameColors(theme, systemDark)
  // Bar layout: a flat, nearly neutral frame; the space colour is an accent (active space, active tab), not the wall.
  const flat = layout === 'bar' ? (f.mode === 'dark' ? mix('#121117', theme.color, 0.07) : mix('#f3f2f6', theme.color, 0.06)) : null
  return {
    '--frame-from': flat ?? f.from,
    '--frame-to': flat ?? f.to,
    '--frame-flat': flat ?? f.from,
    '--accent-on': contrast('#ffffff', theme.color) >= 3 ? '#ffffff' : '#17151f',
    '--frame-text': f.darkText ? '#17151f' : '#f6f5fa',
    '--frame-text-muted': f.darkText ? 'rgba(23,21,31,.66)' : 'rgba(246,245,250,.7)',
    '--frame-hover': f.darkText ? 'rgba(23,21,31,.07)' : 'rgba(255,255,255,.09)',
    '--frame-active': f.darkText ? 'rgba(255,255,255,.72)' : 'rgba(255,255,255,.16)',
    '--frame-line': f.darkText ? 'rgba(23,21,31,.12)' : 'rgba(255,255,255,.14)',
    '--space-color': theme.color,
    '--texture': flat ? 'none' : theme.texture === 'grain' ? GRAIN : theme.texture === 'dots' ? DOTS : 'none',
    '--texture-size': theme.texture === 'dots' ? '14px 14px' : '160px 160px',
    'data-mode': f.mode
  }
}

export function applyTheme(el: HTMLElement, space: Space | undefined, systemDark: boolean, layout: 'bar' | 'sidebar' = 'sidebar'): void {
  if (!space) return
  el.dataset.layout = layout
  const vars = themeVars(space.theme, systemDark, layout)
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'data-mode') el.dataset.mode = v
    else el.style.setProperty(k, v)
  }
}
