// Shortcuts as the user's keyboard shows them. They are stored as Ctrl+T everywhere; on macOS Command does that job.
export const IS_MAC = navigator.userAgent.includes('Mac OS X')

const SYMBOL: Record<string, string> = { Alt: '⌥', Shift: '⇧', Ctrl: '⌘', Meta: '⌘' }
const KEY: Record<string, string> = { Enter: '↩', Left: '←', Right: '→', Up: '↑', Down: '↓', Tab: '⇥', Esc: '⎋', Backspace: '⌫' }

/**
 * A key the input method is still using: Enter or Esc while a Korean, Japanese or Chinese character is being composed
 * finishes or cancels that character and must not also submit, open or close anything. Chromium marks it isComposing;
 * Windows IMEs send it as key code 229 ("Process").
 */
export function composing(e: { nativeEvent: KeyboardEvent; keyCode: number }): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}

/** Ctrl+Shift+T on Windows, ⇧⌘T on macOS (Control+Tab stays ⌃⇥ there: Command+Tab belongs to the system). */
export function keyLabel(acc: string, mac = IS_MAC): string {
  if (!mac) return acc
  const parts = acc.split('+')
  const key = parts.pop() ?? ''
  const mods = ['Alt', 'Shift', 'Ctrl', 'Meta'].filter((m) => parts.includes(m)).map((m) => (m === 'Ctrl' && key === 'Tab' ? '⌃' : SYMBOL[m]))
  return [...new Set(mods)].join('') + (KEY[key] ?? key)
}
