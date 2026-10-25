// Pure rules: which tabs to put to sleep or archive, and how the command bar ranks results.
import type { CommandResult, HistoryEntry, Item, TabRuntime } from '@shared/types'
import { hostOf } from '@shared/util'

const MIN = 60_000
const HOUR = 60 * MIN

/** Awake tabs that are not on screen, not playing audio and idle longer than the limit. */
export function tabsToSleep(
  items: Item[],
  runtime: Record<string, TabRuntime>,
  visible: Set<string>,
  now: number,
  minutes: number
): string[] {
  if (minutes <= 0) return []
  return items
    .filter((i) => i.kind === 'tab' && runtime[i.id]?.awake && !visible.has(i.id) && !runtime[i.id]?.audible)
    .filter((i) => now - i.lastActiveAt > minutes * MIN)
    .map((i) => i.id)
}

/** Today tabs (never pinned or favorites) idle longer than the limit. */
export function tabsToArchive(items: Item[], visible: Set<string>, now: number, hours: number, runtime: Record<string, TabRuntime> = {}): string[] {
  if (hours <= 0) return []
  return items
    .filter((i) => i.kind === 'tab' && i.section === 'today' && !visible.has(i.id) && !runtime[i.id]?.audible)
    .filter((i) => now - i.lastActiveAt > hours * HOUR)
    .map((i) => i.id)
}

/** 0 when the query does not match; higher is better. */
export function matchScore(query: string, text: string | undefined): number {
  if (!text) return 0
  const q = query.toLowerCase().trim()
  const t = text.toLowerCase()
  if (!q) return 0
  if (t === q) return 120
  if (t.startsWith(q)) return 100
  const words = t.split(/[\s/._\-:?=&#]+/)
  if (words.some((w) => w.startsWith(q))) return 70
  if (t.includes(q)) return 40
  // Every query character in order (fuzzy), only for short queries.
  if (q.length <= 12) {
    let j = 0
    for (const c of t) if (c === q[j]) j++
    if (j === q.length) return 12
  }
  return 0
}

export interface ActionDef {
  id: string
  title: string
  keywords?: string
}

export function rankResults(
  query: string,
  tabs: Item[],
  history: HistoryEntry[],
  actions: ActionDef[],
  navigate: CommandResult | null,
  limit = 9
): CommandResult[] {
  const q = query.trim()
  const out: CommandResult[] = []
  const seen = new Set<string>()

  for (const t of tabs) {
    const title = t.customTitle || t.title || hostOf(t.url)
    const s = Math.max(matchScore(q, title), matchScore(q, t.url) * 0.9, matchScore(q, hostOf(t.url)))
    if (!q || s > 0) {
      out.push({ id: 'tab:' + t.id, kind: 'tab', title, subtitle: hostOf(t.url), url: t.url, favicon: t.favicon, itemId: t.id, score: (q ? s : 50) + 25 })
      if (t.url) seen.add(t.url)
    }
  }
  if (q) {
    for (const h of history) {
      if (seen.has(h.url)) continue
      const s = Math.max(matchScore(q, h.title), matchScore(q, h.url) * 0.9, matchScore(q, hostOf(h.url)))
      if (s > 0) out.push({ id: 'h:' + h.url, kind: 'history', title: h.title || h.url, subtitle: hostOf(h.url), url: h.url, score: s + Math.min(20, h.visits * 2) })
    }
    for (const a of actions) {
      const s = Math.max(matchScore(q, a.title), matchScore(q, a.keywords))
      if (s >= 40) out.push({ id: 'a:' + a.id, kind: 'action', title: a.title, action: a.id, score: s + 5 })
    }
  }
  out.sort((a, b) => b.score - a.score)
  const top = out.slice(0, navigate ? limit - 1 : limit)
  return navigate ? [navigate, ...top] : top
}
