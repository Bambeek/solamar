// "Save page for Claude": the open page as files in one folder Claude Code can read, to clone it or take ideas from
// it. Each clip gets its own folder: the page with its images and styles, a full-page screenshot, the text as
// Markdown, the design (colours, fonts, sizes, radii, buttons) and a README saying what each file is.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'

/** Isolated world for reading the page, apart from the page's own scripts and from the agent's world. */
const CLIP_WORLD = 1003
const MAX_SHOT_HEIGHT = 16000 // px: very long pages are cut, so the PNG stays a sane size

export interface ClipInfo {
  dir: string
  url: string
  title: string
  savedAt: string
}

const slug = (s: string, max: number) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'page'

/** Reads the page in its own world: Markdown of the main content, links, images, and the design in use. */
const readPageJs = `(() => {
  const clip = (s, n) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, n)
  const root = document.querySelector('main, article, [role=main]') || document.body
  const out = []
  const walk = (el) => {
    for (const n of el.children) {
      const tag = n.localName
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden' || ['script', 'style', 'noscript', 'svg', 'template'].includes(tag)) continue
      if (/^h[1-6]$/.test(tag)) out.push('#'.repeat(Number(tag[1])) + ' ' + clip(n.innerText, 300))
      else if (tag === 'p' || tag === 'blockquote' || tag === 'figcaption') { const t = clip(n.innerText, 4000); if (t) out.push((tag === 'blockquote' ? '> ' : '') + t) }
      else if (tag === 'li') { const t = clip(n.innerText, 1000); if (t) out.push('- ' + t) }
      else if (tag === 'pre') out.push('\\u0060\\u0060\\u0060\\n' + String(n.innerText).slice(0, 8000) + '\\n\\u0060\\u0060\\u0060')
      else if (tag === 'img' && n.alt) out.push('![' + clip(n.alt, 200) + '](' + n.currentSrc + ')')
      else walk(n)
      if (out.length > 3000) return
    }
  }
  walk(root)
  const links = [...document.querySelectorAll('a[href]')].slice(0, 300).map((a) => ({ text: clip(a.innerText || a.getAttribute('aria-label'), 120), href: a.href })).filter((l) => /^https?:/.test(l.href))
  const images = [...document.images].filter((i) => i.naturalWidth > 32).slice(0, 150).map((i) => ({ src: i.currentSrc, alt: clip(i.alt, 200), width: i.naturalWidth, height: i.naturalHeight }))

  // Design: what the visible part of the page is made of, most used first.
  const tally = () => new Map()
  const add = (m, k) => k && m.set(k, (m.get(k) || 0) + 1)
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }))
  const bg = tally(), fg = tally(), border = tally(), radius = tally(), fonts = tally(), shadow = tally()
  const els = [...document.querySelectorAll('body *')].slice(0, 4000)
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight * 3) continue
    const cs = getComputedStyle(el)
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') add(bg, cs.backgroundColor)
    if (el.childNodes.length && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) { add(fg, cs.color); add(fonts, cs.fontFamily) }
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') add(border, cs.borderTopColor)
    if (cs.borderTopLeftRadius !== '0px') add(radius, cs.borderTopLeftRadius)
    if (cs.boxShadow !== 'none') add(shadow, cs.boxShadow)
  }
  const type = {}
  for (const sel of ['h1', 'h2', 'h3', 'p', 'a', 'button', 'small']) {
    const el = document.querySelector(sel)
    if (!el) continue
    const cs = getComputedStyle(el)
    type[sel] = { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color }
  }
  const buttons = [...document.querySelectorAll('button, a[class*=btn], a[class*=button], [role=button], input[type=submit]')].filter((b) => b.getBoundingClientRect().width > 20).slice(0, 6).map((b) => {
    const cs = getComputedStyle(b)
    return { text: clip(b.innerText || b.value, 40), background: cs.backgroundColor, color: cs.color, borderRadius: cs.borderRadius, padding: cs.padding, border: cs.border, fontSize: cs.fontSize, fontWeight: cs.fontWeight }
  })
  const body = getComputedStyle(document.body)
  return {
    markdown: out.join('\\n\\n').slice(0, 400000),
    links,
    images,
    design: {
      page: { background: body.backgroundColor, color: body.color, fontFamily: body.fontFamily, fontSize: body.fontSize, maxContentWidth: Math.round(root.getBoundingClientRect().width) },
      backgrounds: top(bg, 12), textColors: top(fg, 10), borderColors: top(border, 8), radii: top(radius, 8), shadows: top(shadow, 5), fonts: top(fonts, 6),
      typography: type,
      buttons
    }
  }
})()`

async function screenshotFull(wc: WebContents, file: string): Promise<void> {
  const dbg = wc.debugger
  let attached = false
  try {
    if (!dbg.isAttached()) {
      dbg.attach('1.3')
      attached = true
    }
    const m = (await dbg.sendCommand('Page.getLayoutMetrics')) as { cssContentSize?: { width: number; height: number }; contentSize: { width: number; height: number } }
    const size = m.cssContentSize ?? m.contentSize
    const shot = (await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.min(Math.ceil(size.height), MAX_SHOT_HEIGHT), scale: 1 }
    })) as { data: string }
    writeFileSync(file, Buffer.from(shot.data, 'base64'))
  } catch {
    // DevTools open on the page (it holds the debugger) or a page that refuses: the visible part will do.
    writeFileSync(file, (await wc.capturePage()).toPNG())
  } finally {
    if (attached && dbg.isAttached()) dbg.detach()
  }
}

const ROOT_README = `# Pages saved from Solamar

Each folder here is one web page saved with "Save page for Claude" in Solamar (right-click on a page, or the
command bar). Folders are named \`<date>-<site>-<title>\`; \`index.json\` lists them, newest first.

In every folder:

- \`page.html\` and \`page_files/\`: the page as the browser had it, with its images, styles and scripts
- \`screenshot.png\`: the whole page (very long pages are cut at ${MAX_SHOT_HEIGHT}px); \`screenshot-top.png\`: what was on screen
- \`content.md\`: the text of the main content as Markdown, then its links and images
- \`design.json\`: colours, fonts, type sizes, corner radii, shadows and button styles in use, most used first
- \`meta.json\`: address, title, when it was saved, the files

Use them to rebuild the page, borrow its layout or style, or quote its text. They are copies for reference:
the site's own terms and copyright still apply.
`

/** Saves the page into a new folder under `root`; returns the folder. */
export async function saveClip(wc: WebContents, root: string): Promise<ClipInfo> {
  const url = wc.getURL()
  const title = wc.getTitle() || url
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return 'page'
    }
  })()
  const now = new Date()
  const stamp = now.toISOString().slice(0, 10)
  mkdirSync(root, { recursive: true })
  let dir = join(root, `${stamp}-${slug(host, 40)}-${slug(title, 40)}`)
  for (let i = 2; existsSync(dir); i++) dir = join(root, `${stamp}-${slug(host, 40)}-${slug(title, 40)}-${i}`)
  mkdirSync(dir)

  const files: string[] = []
  try {
    await wc.savePage(join(dir, 'page.html'), 'HTMLComplete')
    files.push('page.html', 'page_files/')
  } catch {
    await wc.savePage(join(dir, 'page.html'), 'HTMLOnly').then(() => files.push('page.html')).catch(() => {})
  }
  await screenshotFull(wc, join(dir, 'screenshot.png'))
  writeFileSync(join(dir, 'screenshot-top.png'), (await wc.capturePage()).toPNG())
  files.push('screenshot.png', 'screenshot-top.png')

  const read = (await wc.executeJavaScriptInIsolatedWorld(CLIP_WORLD, [{ code: readPageJs }]).catch(() => null)) as {
    markdown: string
    links: { text: string; href: string }[]
    images: { src: string; alt: string; width: number; height: number }[]
    design: unknown
  } | null
  if (read) {
    const md = [
      `# ${title}`,
      `Source: ${url}  \nSaved: ${now.toISOString()}`,
      read.markdown,
      read.links.length ? '## Links\n\n' + read.links.map((l) => `- [${l.text || l.href}](${l.href})`).join('\n') : '',
      read.images.length ? '## Images\n\n' + read.images.map((i) => `- ${i.src} (${i.width}x${i.height})${i.alt ? ` "${i.alt}"` : ''}`).join('\n') : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    writeFileSync(join(dir, 'content.md'), md)
    writeFileSync(join(dir, 'design.json'), JSON.stringify(read.design, null, 2))
    files.push('content.md', 'design.json')
  }
  const info: ClipInfo = { dir, url, title, savedAt: now.toISOString() }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...info, files }, null, 2))
  writeFileSync(
    join(dir, 'README.md'),
    `# ${title}\n\nSaved from ${url} on ${now.toISOString().slice(0, 16).replace('T', ' ')} by Solamar, for Claude Code.\n\n${files.map((f) => `- \`${f}\``).join('\n')}\n\nSee ../README.md for what each file holds.\n`
  )

  writeFileSync(join(root, 'README.md'), ROOT_README)
  const index = listClips(root).filter((c) => c.dir !== dir)
  writeFileSync(join(root, 'index.json'), JSON.stringify([info, ...index].slice(0, 500), null, 2))
  return info
}

/** Saved clips, newest first (from index.json). */
export function listClips(root: string): ClipInfo[] {
  try {
    const list = JSON.parse(readFileSync(join(root, 'index.json'), 'utf-8'))
    return Array.isArray(list) ? list.filter((c) => c && typeof c.dir === 'string' && existsSync(c.dir)) : []
  } catch {
    return []
  }
}
