// Space icons are Lucide icon ids (no emoji anywhere in the UI). The renderer maps ids to components.

export const SPACE_ICONS = [
  'house', 'briefcase', 'code', 'terminal', 'gamepad', 'book', 'graduation', 'palette', 'pen', 'camera',
  'music', 'film', 'cart', 'wallet', 'chart', 'mail', 'calendar', 'users', 'heart', 'star',
  'coffee', 'plane', 'map', 'leaf', 'dumbbell', 'flask', 'lightbulb', 'newspaper', 'rocket', 'wrench',
  'shield', 'globe', 'bank', 'circle'
] as const

export type SpaceIcon = (typeof SPACE_ICONS)[number]

export const DEFAULT_SPACE_ICONS: SpaceIcon[] = ['house', 'briefcase', 'code', 'book', 'palette', 'gamepad', 'music', 'star']

export function isSpaceIcon(v: unknown): v is SpaceIcon {
  return typeof v === 'string' && (SPACE_ICONS as readonly string[]).includes(v)
}

// Common emoji (Arc spaces, old Solamar data) -> closest icon. Unknown emoji fall back to a default.
const EMOJI_ICON: Record<string, SpaceIcon> = {
  '🏠': 'house', '🏡': 'house', '💼': 'briefcase', '👔': 'briefcase', '🏢': 'briefcase', '💻': 'code', '🧑‍💻': 'code', '👨‍💻': 'code',
  '⌨️': 'terminal', '🖥️': 'terminal', '🎮': 'gamepad', '🕹️': 'gamepad', '📚': 'book', '📖': 'book', '📕': 'book', '🎓': 'graduation',
  '🎨': 'palette', '🖌️': 'palette', '✏️': 'pen', '📝': 'pen', '📷': 'camera', '📸': 'camera', '🎵': 'music', '🎶': 'music', '🎧': 'music',
  '🎬': 'film', '🍿': 'film', '📺': 'film', '🛒': 'cart', '🛍️': 'cart', '💰': 'wallet', '💵': 'wallet', '💳': 'wallet', '🏦': 'bank',
  '📈': 'chart', '📊': 'chart', '📧': 'mail', '✉️': 'mail', '📅': 'calendar', '🗓️': 'calendar', '👥': 'users', '👪': 'users',
  '❤️': 'heart', '💜': 'heart', '💙': 'heart', '⭐': 'star', '🌟': 'star', '✨': 'star', '☕': 'coffee', '✈️': 'plane', '🗺️': 'map',
  '🌍': 'globe', '🌎': 'globe', '🌐': 'globe', '🌿': 'leaf', '🌱': 'leaf', '🏋️': 'dumbbell', '💪': 'dumbbell', '🧪': 'flask', '🔬': 'flask',
  '💡': 'lightbulb', '📰': 'newspaper', '🚀': 'rocket', '🔧': 'wrench', '🛠️': 'wrench', '🛡️': 'shield', '🔒': 'shield'
}

export function iconFromEmoji(emoji: string | undefined, fallbackIndex = 0): SpaceIcon {
  if (emoji) {
    const plain = emoji.replace(/️/g, '')
    const hit = EMOJI_ICON[emoji] ?? Object.entries(EMOJI_ICON).find(([e]) => e.replace(/️/g, '') === plain)?.[1]
    if (hit) return hit
  }
  return DEFAULT_SPACE_ICONS[fallbackIndex % DEFAULT_SPACE_ICONS.length]
}
