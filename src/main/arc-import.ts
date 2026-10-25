// Finds Arc's sidebar file and merges an ArcPlan into our document. Arc's files are only ever read.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { THEME_PRESETS } from '@shared/defaults'
import type { ArcPreview, Doc, ImportSummary, Item, Section } from '@shared/types'
import { iconFromEmoji } from '@shared/icons'
import { mix, uid } from '@shared/util'
import { type ArcNode, type ArcPlan, countNodes, parseArcSidebar } from './arc-parse'
import { DEFAULT_PROFILE_ID } from './store'

export function locateArcSidebar(): string | null {
  const candidates: string[] = []
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    const pkgs = join(local, 'Packages')
    try {
      for (const d of readdirSync(pkgs)) if (d.startsWith('TheBrowserCompany.Arc_')) candidates.push(join(pkgs, d, 'LocalCache', 'Local', 'Arc', 'StorableSidebar.json'))
    } catch {}
  } else if (process.platform === 'darwin') {
    candidates.push(join(homedir(), 'Library', 'Application Support', 'Arc', 'StorableSidebar.json'))
  }
  return candidates.find((p) => existsSync(p)) ?? null
}

export function readArcPlan(path: string): ArcPlan {
  return parseArcSidebar(JSON.parse(readFileSync(path, 'utf-8')))
}

export function previewPlan(path: string, plan: ArcPlan): ArcPreview {
  return {
    path,
    favorites: plan.favorites.length,
    spaces: plan.spaces.map((s, i) => {
      const p = countNodes(s.pinned)
      const t = countNodes(s.today)
      return { title: s.title, icon: iconFromEmoji(s.emoji, i), color: s.color, pinned: p.tabs, today: t.tabs, folders: p.folders + t.folders }
    })
  }
}

export function applyArcPlan(doc: Doc, plan: ArcPlan, opts: { includeToday: boolean }, now = Date.now()): ImportSummary {
  const summary: ImportSummary = { spaces: 0, tabs: 0, folders: 0, favorites: 0 }
  const profiles = new Map<string, string>([['default', DEFAULT_PROFILE_ID]])
  let pos = Math.max(-1, ...doc.spaces.map((s) => s.position)) + 1

  const add = (nodes: ArcNode[], spaceId: string | null, section: Section, parentId: string | null) => {
    nodes.forEach((n, i) => {
      const item: Item = {
        id: uid('i-'),
        spaceId,
        parentId,
        kind: n.kind,
        section,
        title: n.title,
        url: n.kind === 'tab' ? n.url : undefined,
        position: i,
        createdAt: now,
        lastActiveAt: now // imported today tabs get a fresh archive timer
      }
      doc.items.push(item)
      if (n.kind === 'tab') summary.tabs++
      else {
        summary.folders++
        add(n.children ?? [], spaceId, section, item.id)
      }
    })
  }

  for (const s of plan.spaces) {
    let profileId = profiles.get(s.profile)
    if (!profileId) {
      profileId = uid('p-')
      const n = doc.profiles.length
      doc.profiles.push({ id: profileId, name: `Arc profile ${n}`, partition: `persist:solamar-${profileId}`, isDefault: false })
      profiles.set(s.profile, profileId)
    }
    const preset = THEME_PRESETS[summary.spaces % THEME_PRESETS.length]
    const title = doc.spaces.some((x) => x.title === s.title) ? `${s.title} (Arc)` : s.title
    const spaceId = uid('s-')
    doc.spaces.push({
      id: spaceId,
      profileId,
      title,
      icon: iconFromEmoji(s.emoji, summary.spaces),
      theme: s.color ? { color: s.color, color2: mix(s.color, '#ffffff', 0.35), mode: 'auto', texture: 'grain', intensity: 0.7 } : { ...preset },
      position: pos++
    })
    summary.spaces++
    add(s.pinned, spaceId, 'pinned', null)
    if (opts.includeToday) add(s.today, spaceId, 'today', null)
  }

  const haveFav = new Set(doc.items.filter((i) => i.section === 'favorites').map((i) => i.url))
  let favPos = doc.items.filter((i) => i.section === 'favorites').length
  for (const f of plan.favorites) {
    if (!f.url || haveFav.has(f.url)) continue
    haveFav.add(f.url)
    doc.items.push({ id: uid('i-'), spaceId: null, parentId: null, kind: 'tab', section: 'favorites', title: f.title, url: f.url, position: favPos++, createdAt: now, lastActiveAt: now })
    summary.favorites++
  }
  return summary
}
