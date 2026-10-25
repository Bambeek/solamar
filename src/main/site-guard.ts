// Stops known phishing and malware pages before they load, in place of Chrome's Safe Browsing (which Electron leaves
// out). Two host lists, refreshed every 12 hours and cached in userData: malware-filter's phishing-filter (OpenPhish,
// IPThreat, PhishTank) and urlhaus-filter (abuse.ch URLhaus, sites serving malware right now). The lists come down;
// nothing about what you browse goes up. A listed host is matched with its subdomains. The user can open a stopped
// page anyway, which lasts until Solamar quits.
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Danger = 'phishing' | 'malware'

const LISTS: { kind: Danger; file: string; urls: string[] }[] = [
  {
    kind: 'phishing',
    file: 'guard-phishing.txt',
    urls: [
      'https://malware-filter.gitlab.io/malware-filter/phishing-filter-hosts.txt',
      'https://malware-filter.pages.dev/phishing-filter-hosts.txt',
      'https://curbengh.github.io/malware-filter/phishing-filter-hosts.txt'
    ]
  },
  {
    kind: 'malware',
    file: 'guard-malware.txt',
    urls: [
      'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt',
      'https://malware-filter.pages.dev/urlhaus-filter-hosts-online.txt',
      'https://curbengh.github.io/malware-filter/urlhaus-filter-hosts-online.txt'
    ]
  }
]
// The lists' own "Expires: 12 hours".
const MAX_AGE_MS = 12 * 60 * 60 * 1000

/** Hostnames from a hosts file ("0.0.0.0 example.com") or a plain list, lower case, comments and blanks dropped. */
export function parseHosts(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    const host = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase()
    if (host.includes('.') && host !== 'localhost') out.push(host)
  }
  return out
}

/** The host itself or the nearest listed parent domain, so a listed site's subdomains are caught too. */
export function matchHost(host: string, listed: (h: string) => boolean): string | null {
  for (let h = host.toLowerCase().replace(/\.$/, ''); h.includes('.'); h = h.slice(h.indexOf('.') + 1)) if (listed(h)) return h
  return null
}

const hostOf = (url: string): string => {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.hostname : ''
  } catch {
    return ''
  }
}

export class SiteGuard {
  private hosts = new Map<string, Danger>()
  private openedAnyway = new Set<string>()

  constructor(private readonly dir: string) {}

  get size(): number {
    return this.hosts.size
  }

  /** Cached lists first so it protects from the first page; fresh ones in the background, then every 12 hours. */
  async init(): Promise<void> {
    await Promise.all(LISTS.map((l) => this.load(l, false)))
    setInterval(() => void Promise.all(LISTS.map((l) => this.load(l, true))), MAX_AGE_MS).unref()
  }

  /** Why the page should not open, or null. Only web pages; a page the user chose to open anyway passes. */
  check(url: string): { host: string; danger: Danger } | null {
    const host = hostOf(url)
    if (!host || this.openedAnyway.has(host)) return null
    const hit = matchHost(host, (h) => this.hosts.has(h))
    return hit ? { host, danger: this.hosts.get(hit)! } : null
  }

  openAnyway(url: string): void {
    const host = hostOf(url)
    if (host) this.openedAnyway.add(host)
  }

  private async load(list: (typeof LISTS)[number], refresh: boolean): Promise<void> {
    const path = join(this.dir, list.file)
    let text = await readFile(path, 'utf8').catch(() => '')
    const age = await stat(path).then((s) => Date.now() - s.mtimeMs, () => Infinity)
    if (text) this.apply(list.kind, text)
    if (!refresh && age < MAX_AGE_MS) return
    for (const url of list.urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) continue
        text = await res.text()
        if (parseHosts(text).length < 10) continue // an error page, not a list
        await writeFile(path, text)
        this.apply(list.kind, text)
        return
      } catch {
        // next mirror
      }
    }
    console.error(`[guard] could not refresh the ${list.kind} list; using ${text ? 'the cached one' : 'none'}`)
  }

  private apply(kind: Danger, text: string): void {
    for (const [h, k] of this.hosts) if (k === kind) this.hosts.delete(h)
    for (const h of parseHosts(text)) if (!this.hosts.has(h)) this.hosts.set(h, kind)
  }
}
