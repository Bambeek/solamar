// Shortcuts as the user's keyboard shows them. They are stored as Ctrl+T everywhere; on macOS Command does that job.
export const IS_MAC = navigator.userAgent.includes('Mac OS X')

const SYMBOL: Record<string, string> = { Alt: '⌥', Shift: '⇧', Ctrl: '⌘', Meta: '⌘' }
const KEY: Record<string, string> = { Enter: '↩', Left: '←', Right: '→', Up: '↑', Down: '↓', Tab: '⇥', Esc: '⎋', Backspace: '⌫' }

/** Ctrl+Shift+T on Windows, ⇧⌘T on macOS (Control+Tab stays ⌃⇥ there: Command+Tab belongs to the system). */
export function keyLabel(acc: string, mac = IS_MAC): string {
  if (!mac) return acc
  const parts = acc.split('+')
  const key = parts.pop() ?? ''
  const mods = ['Alt', 'Shift', 'Ctrl', 'Meta'].filter((m) => parts.includes(m)).map((m) => (m === 'Ctrl' && key === 'Tab' ? '⌃' : SYMBOL[m]))
  return [...new Set(mods)].join('') + (KEY[key] ?? key)
}
