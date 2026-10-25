import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { applyImport, MAX_BOOKMARKS } from '../src/main/importers/apply'
import { parseBplist } from '../src/main/importers/bplist'
import { parseChromiumBookmarks, readChromiumHistory, webkitToMs } from '../src/main/importers/chromium'
import { readFirefoxPlaces } from '../src/main/importers/firefox'
import { readSource } from '../src/main/importers/index'
import { listSources, parseProfilesIni } from '../src/main/importers/locate'
import { originOf, parseCsv, parsePasswordsCsv } from '../src/main/importers/passwords-csv'
import { parseSafariBookmarks, safariHistoryFromDb } from '../src/main/importers/safari'
import { type BookmarkNode, countBookmarks, type ImportData, ImportError } from '../src/main/importers/types'
import { freshDoc } from '../src/main/store'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/importers/${name}`, import.meta.url), 'utf-8').replace(/\r\n/g, '\n')

const scratch = mkdtempSync(join(tmpdir(), 'solamar-importers-test-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let dirN = 0
const newDir = (...parts: string[]) => {
  const d = join(scratch, String(dirN++), ...parts)
  mkdirSync(d, { recursive: true })
  return d
}

// WebKit microseconds for a given ms epoch time (as Chrome stores them, beyond 2^53).
const webkit = (ms: number) => BigInt(ms + 11644473600000) * 1000n
const T1 = Date.UTC(2026, 0, 2, 3, 4, 5)
const T2 = Date.UTC(2026, 5, 7, 8, 9, 10)

function makeChromiumHistory(file: string, wal = false): DatabaseSync {
  const db = new DatabaseSync(file)
  if (wal) db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL,
    typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)`)
  const add = db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)')
  add.run('https://old.example.com/', 'Old', 3, webkit(T1), 0)
  add.run('https://new.example.com/a', 'New', 12, webkit(T2), 0)
  add.run('https://hidden.example.com/', 'Hidden', 1, webkit(T2), 1)
  add.run('chrome://settings/', 'Settings', 5, webkit(T2), 0)
  add.run('https://never.example.com/', 'Never', 0, 0, 0)
  return db
}

function makePlaces(file: string, wal = false): DatabaseSync {
  const db = new DatabaseSync(file)
  if (wal) db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0 NOT NULL, last_visit_date INTEGER, guid TEXT);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER DEFAULT NULL, parent INTEGER, position INTEGER,
      title LONGVARCHAR, dateAdded INTEGER, lastModified INTEGER, guid TEXT);`)
  const place = db.prepare('INSERT INTO moz_places (id, url, title, visit_count, last_visit_date, hidden) VALUES (?, ?, ?, ?, ?, ?)')
  place.run(1, 'https://mdn.example.org/', 'MDN', 7, T2 * 1000, 0)
  place.run(2, 'https://blog.example.com/post', 'Post', 2, T1 * 1000, 0)
  place.run(3, 'place:sort=8&maxResults=10', 'Recent', 0, null, 0)
  place.run(4, 'https://unvisited.example.com/', 'Unvisited', 0, null, 0)
  place.run(5, 'about:config', 'Config', 4, T2 * 1000, 0)
  place.run(6, 'https://tagged.example.com/', 'Tagged', 1, (T1 - 1000) * 1000, 0)
  const bm = db.prepare('INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, dateAdded, guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  bm.run(1, 2, null, 0, 0, '', T1 * 1000, 'root________')
  bm.run(2, 2, null, 1, 0, 'menu', T1 * 1000, 'menu________')
  bm.run(3, 2, null, 1, 1, 'toolbar', T1 * 1000, 'toolbar_____')
  bm.run(4, 2, null, 1, 2, 'tags', T1 * 1000, 'tags________')
  bm.run(5, 2, null, 1, 3, 'unfiled', T1 * 1000, 'unfiled_____')
  bm.run(6, 2, null, 1, 4, 'mobile', T1 * 1000, 'mobile______')
  // toolbar: a bookmark, then a folder with a separator, a query and a bookmark (positions out of insert order)
  bm.run(10, 2, null, 3, 1, 'Dev', T1 * 1000, 'f1')
  bm.run(11, 1, 1, 3, 0, 'MDN docs', T2 * 1000, 'b1')
  bm.run(12, 3, null, 10, 0, null, T1 * 1000, 's1')
  bm.run(13, 1, 3, 10, 1, 'Recently bookmarked', T1 * 1000, 'q1')
  bm.run(14, 1, 2, 10, 2, 'A post', T1 * 1000, 'b2')
  bm.run(15, 2, null, 4, 0, 'some-tag', T1 * 1000, 't1')
  bm.run(16, 1, 6, 15, 0, null, T1 * 1000, 't2')
  bm.run(17, 1, 4, 5, 0, 'Unvisited', T1 * 1000, 'b3')
  return db
}

// Small bplist00 writer for tests: 2-byte object refs, 4-byte offsets.
function encodeBplist(root: unknown): Uint8Array {
  const objects: number[][] = []
  const be = (n: number, size: number) => Array.from({ length: size }, (_, i) => Math.floor(n / 256 ** (size - 1 - i)) % 256)
  const intObj = (n: number) => (n < 256 ? [0x10, n] : n < 65536 ? [0x11, ...be(n, 2)] : [0x12, ...be(n, 4)])
  const head = (type: number, len: number) => (len < 15 ? [(type << 4) | len] : [(type << 4) | 0xf, ...intObj(len)])
  const eight = (set: (v: DataView) => void) => {
    const b = new DataView(new ArrayBuffer(8))
    set(b)
    return [...new Uint8Array(b.buffer)]
  }
  const f64 = (x: number) => eight((b) => b.setFloat64(0, x))
  const enc = (v: unknown): number => {
    let bytes: number[]
    if (v === null) bytes = [0x00]
    else if (typeof v === 'boolean') bytes = [v ? 0x09 : 0x08]
    else if (typeof v === 'number' && Number.isInteger(v) && v >= 0) bytes = intObj(v)
    else if (typeof v === 'number' && Number.isInteger(v)) bytes = [0x13, ...eight((b) => b.setBigInt64(0, BigInt(v)))]
    else if (typeof v === 'number') bytes = [0x23, ...f64(v)]
    else if (v instanceof Date) bytes = [0x33, ...f64((v.getTime() - 978307200000) / 1000)]
    else if (typeof v === 'string') {
      const ascii = /^[\x00-\x7f]*$/.test(v)
      bytes = ascii ? [...head(5, v.length), ...[...v].map((c) => c.charCodeAt(0))] : [...head(6, v.length), ...[...Array(v.length).keys()].flatMap((i) => be(v.charCodeAt(i), 2))]
    } else if (Array.isArray(v)) {
      const refs = v.map(enc)
      bytes = [...head(0xa, refs.length), ...refs.flatMap((r) => be(r, 2))]
    } else {
      const entries = Object.entries(v as object)
      const keys = entries.map(([k]) => enc(k))
      const vals = entries.map(([, x]) => enc(x))
      bytes = [...head(0xd, entries.length), ...[...keys, ...vals].flatMap((r) => be(r, 2))]
    }
    objects.push(bytes)
    return objects.length - 1
  }
  const top = enc(root)
  const out: number[] = [...'bplist00'].map((c) => c.charCodeAt(0))
  const offsets: number[] = []
  for (const o of objects) {
    offsets.push(out.length)
    out.push(...o)
  }
  const tableAt = out.length
  for (const off of offsets) out.push(...be(off, 4))
  out.push(0, 0, 0, 0, 0, 0, 4, 2, ...be(objects.length, 8), ...be(top, 8), ...be(tableAt, 8))
  return new Uint8Array(out)
}

describe('Chromium bookmarks', () => {
  const roots = parseChromiumBookmarks(JSON.parse(fixture('chromium-Bookmarks.json')))

  it('keeps non-empty roots in order with nested folders', () => {
    expect(roots.map((r) => [r.root, r.title])).toEqual([
      ['toolbar', 'Bookmarks bar'],
      ['other', 'Other bookmarks']
    ])
    const research = roots[0].children![1]
    expect(research.kind).toBe('folder')
    expect(research.children![1].children!.map((n) => n.title)).toEqual(['Deep page', 'Docs again'])
    expect(countBookmarks(roots)).toEqual({ bookmarks: 8, folders: 3 })
  })

  it('converts WebKit timestamps past 2^53 without losing the date', () => {
    expect(webkitToMs('13300000000000000')).toBe(1655526400000)
    expect(roots[0].children![0].addedAt).toBe(1655526400000)
    expect(webkitToMs('0')).toBeUndefined()
  })

  it('rejects other JSON', () => {
    expect(() => parseChromiumBookmarks({ foo: 1 })).toThrow(ImportError)
  })
})

describe('Chromium history', () => {
  it('reads a copy, newest first, web pages only', async () => {
    const profile = newDir('Default')
    makeChromiumHistory(join(profile, 'History')).close()
    const before = readdirSync(profile)
    const h = await readChromiumHistory(profile)
    expect(h).toEqual([
      { url: 'https://new.example.com/a', title: 'New', visits: 12, lastVisit: T2 },
      { url: 'https://old.example.com/', title: 'Old', visits: 3, lastVisit: T1 }
    ])
    expect(readdirSync(profile)).toEqual(before) // nothing written next to the live file
  })

  it('sees writes still in the -wal file while the browser holds the database', async () => {
    const profile = newDir('Profile 1')
    const live = makeChromiumHistory(join(profile, 'History'), true)
    live.exec('PRAGMA wal_autocheckpoint = 0')
    live.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?)').run('https://fresh.example.com/', 'Fresh', 1, webkit(T2 + 1000))
    try {
      const h = await readChromiumHistory(profile, 1)
      expect(h.map((x) => x.url)).toEqual(['https://fresh.example.com/'])
    } finally {
      live.close()
    }
  })
})

describe('Firefox places.sqlite', () => {
  it('builds the bookmark tree: toolbar, menu, other; skips tags, separators and place: queries', async () => {
    const profile = newDir('abcd.default-release')
    makePlaces(join(profile, 'places.sqlite')).close()
    const { bookmarks, history, warnings } = await readFirefoxPlaces(profile)
    expect(warnings).toEqual([])
    expect(bookmarks.map((r) => r.root)).toEqual(['toolbar', 'unfiled'])
    const [toolbar, other] = bookmarks
    expect(toolbar.children!.map((n) => n.title)).toEqual(['MDN docs', 'Dev'])
    expect(toolbar.children![0]).toMatchObject({ kind: 'bookmark', url: 'https://mdn.example.org/', addedAt: T2 })
    expect(toolbar.children![1].children!.map((n) => n.url)).toEqual(['https://blog.example.com/post'])
    expect(other.children!.map((n) => n.url)).toEqual(['https://unvisited.example.com/'])
    expect(JSON.stringify(bookmarks)).not.toMatch(/tagged|place:/)
    expect(history).toEqual([
      { url: 'https://mdn.example.org/', title: 'MDN', visits: 7, lastVisit: T2 },
      { url: 'https://blog.example.com/post', title: 'Post', visits: 2, lastVisit: T1 },
      { url: 'https://tagged.example.com/', title: 'Tagged', visits: 1, lastVisit: T1 - 1000 }
    ])
  })

  it('reads a WAL database whose -wal file is gone (closed cleanly)', async () => {
    const profile = newDir('wal.default')
    makePlaces(join(profile, 'places.sqlite'), true).close()
    const { bookmarks } = await readFirefoxPlaces(profile, { history: false })
    expect(countBookmarks(bookmarks).bookmarks).toBe(3)
  })

  it('profiles.ini: the Install default wins over Default=1', () => {
    const base = join(scratch, 'ff')
    const profiles = parseProfilesIni(fixture('profiles.ini'), base)
    expect(profiles.map((p) => [p.name, p.isDefault])).toEqual([
      ['default', false],
      ['default-release', true]
    ])
    expect(profiles[1].path).toBe(join(base, 'Profiles', 'abcd1234.default-release'))
    const old = parseProfilesIni('[Profile0]\nName=only\nIsRelative=1\nPath=Profiles/x.default\nDefault=1\n', base)
    expect(old[0].isDefault).toBe(true)
  })
})

describe('Safari', () => {
  const plist = {
    WebBookmarkType: 'WebBookmarkTypeList',
    Title: '',
    Children: [
      { WebBookmarkType: 'WebBookmarkTypeProxy', Title: 'History' },
      {
        WebBookmarkType: 'WebBookmarkTypeList',
        Title: 'BookmarksBar',
        Children: [
          { WebBookmarkType: 'WebBookmarkTypeLeaf', URLString: 'https://apple.example.com/', URIDictionary: { title: 'Zażółć gęślą' } },
          {
            WebBookmarkType: 'WebBookmarkTypeList',
            Title: 'Travel',
            Children: [{ WebBookmarkType: 'WebBookmarkTypeLeaf', URLString: 'https://maps.example.com/' + 'x'.repeat(300), URIDictionary: { title: 'Map' } }]
          }
        ]
      },
      { WebBookmarkType: 'WebBookmarkTypeList', Title: 'BookmarksMenu', Children: [] },
      {
        WebBookmarkType: 'WebBookmarkTypeList',
        Title: 'com.apple.ReadingList',
        Children: [{ WebBookmarkType: 'WebBookmarkTypeLeaf', URLString: 'https://read.example.com/later', URIDictionary: { title: 'Later' }, ReadingList: { DateAdded: new Date(T1) } }]
      },
      { WebBookmarkType: 'WebBookmarkTypeLeaf', URLString: 'https://loose.example.com/', URIDictionary: { title: 'Loose' } }
    ],
    WebBookmarkFileVersion: 1
  }

  it('binary plist round trip: ints, reals, dates, unicode and long strings, nesting', () => {
    const value = { a: [0, 255, 256, 70000, -5], b: 1.5, c: true, d: false, e: null, f: new Date(T1), g: 'Zażółć', h: 'y'.repeat(400) }
    expect(parseBplist(encodeBplist(value))).toEqual(value)
  })

  it('rejects broken and XML plists', () => {
    expect(() => parseBplist(new TextEncoder().encode('<?xml version="1.0"?><plist></plist>' + ' '.repeat(40)))).toThrow(/XML/)
    const good = encodeBplist({ a: 1 })
    expect(() => parseBplist(good.slice(0, good.length - 4))).toThrow(ImportError)
  })

  it('maps Bookmarks.plist: favorites bar, reading list, loose items; skips the History proxy', () => {
    const roots = parseSafariBookmarks(parseBplist(encodeBplist(plist)))
    expect(roots.map((r) => [r.root, r.title])).toEqual([
      ['toolbar', 'Favorites'],
      ['other', 'Bookmarks'],
      ['reading', 'Reading List']
    ])
    expect(roots[0].children![0]).toEqual({ kind: 'bookmark', title: 'Zażółć gęślą', url: 'https://apple.example.com/' })
    expect(roots[0].children![1].children![0].url).toHaveLength('https://maps.example.com/'.length + 300)
    expect(() => parseSafariBookmarks({})).toThrow(ImportError)
  })

  it('reads History.db: seconds since 2001, latest visit title', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT, visit_count INTEGER);
      CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER, visit_time REAL, title TEXT);`)
    db.exec("INSERT INTO history_items VALUES (1, 'https://a.example.com/', 4), (2, 'https://b.example.com/', 1), (3, 'file:///x', 1)")
    const s = (ms: number) => ms / 1000 - 978307200
    db.prepare('INSERT INTO history_visits (history_item, visit_time, title) VALUES (?, ?, ?)').run(1, s(T1), 'A old')
    db.prepare('INSERT INTO history_visits (history_item, visit_time, title) VALUES (?, ?, ?)').run(1, s(T2), 'A new')
    db.prepare('INSERT INTO history_visits (history_item, visit_time, title) VALUES (?, ?, ?)').run(2, s(T1), null)
    db.prepare('INSERT INTO history_visits (history_item, visit_time, title) VALUES (?, ?, ?)').run(3, s(T2), 'file')
    expect(safariHistoryFromDb(db)).toEqual([
      { url: 'https://a.example.com/', title: 'A new', visits: 4, lastVisit: T2 },
      { url: 'https://b.example.com/', title: undefined, visits: 1, lastVisit: T1 }
    ])
    db.close()
  })
})

describe('listSources', () => {
  it('Windows: Chromium profiles named from Local State, Firefox from profiles.ini, no Safari', () => {
    const local = newDir('Local')
    const roaming = newDir('Roaming')
    const chrome = join(local, 'Google', 'Chrome', 'User Data')
    for (const p of ['Default', 'Profile 2', 'Profile 10', 'System Profile']) mkdirSync(join(chrome, p), { recursive: true })
    writeFileSync(join(chrome, 'Default', 'Bookmarks'), '{}')
    writeFileSync(join(chrome, 'Profile 2', 'History'), '')
    writeFileSync(join(chrome, 'Profile 10', 'Bookmarks'), '{}')
    writeFileSync(join(chrome, 'System Profile', 'History'), '')
    writeFileSync(join(chrome, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 2', info_cache: { Default: { name: 'Person 1' }, 'Profile 2': { name: 'Work' } } } }))
    const edge = join(local, 'Microsoft', 'Edge', 'User Data', 'Default')
    mkdirSync(edge, { recursive: true })
    writeFileSync(join(edge, 'History'), '')
    const ff = join(roaming, 'Mozilla', 'Firefox')
    mkdirSync(join(ff, 'Profiles', 'abcd1234.default-release'), { recursive: true })
    mkdirSync(join(ff, 'Profiles', 'wxyz9876.default'), { recursive: true })
    writeFileSync(join(ff, 'profiles.ini'), fixture('profiles.ini'))
    writeFileSync(join(ff, 'Profiles', 'abcd1234.default-release', 'places.sqlite'), '')

    const sources = listSources({ platform: 'win32', home: scratch, localAppData: local, appData: roaming })
    expect(sources.map((s) => [s.browser, s.profileName, s.isDefault, s.has.bookmarks, s.has.history])).toEqual([
      ['chrome', 'Work', true, false, true],
      ['chrome', 'Person 1', false, true, false],
      ['chrome', 'Profile 10', false, true, false],
      ['edge', 'Default', true, false, true],
      ['firefox', 'default-release', true, true, true]
    ])
    expect(sources[0].profilePath).toBe(join(chrome, 'Profile 2'))
  })

  it('macOS: Application Support paths and Safari; Linux: ~/.config and ~/.mozilla', () => {
    const home = newDir('home')
    const brave = join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'Default')
    mkdirSync(brave, { recursive: true })
    writeFileSync(join(brave, 'Bookmarks'), '{}')
    mkdirSync(join(home, 'Library', 'Safari'), { recursive: true })
    writeFileSync(join(home, 'Library', 'Safari', 'History.db'), '')
    const mac = listSources({ platform: 'darwin', home })
    expect(mac.map((s) => [s.browser, s.has.bookmarks, s.has.history, s.needsPermission ?? false])).toEqual([
      ['brave', true, false, false],
      ['safari', false, true, false]
    ])
    expect(listSources({ platform: 'linux', home })).toEqual([])

    const ff = join(home, '.mozilla', 'firefox', 'x1.default')
    mkdirSync(ff, { recursive: true })
    writeFileSync(join(home, '.mozilla', 'firefox', 'profiles.ini'), '[Profile0]\nName=default\nIsRelative=1\nPath=x1.default\nDefault=1\n')
    writeFileSync(join(ff, 'places.sqlite'), '')
    const edge = join(home, '.config', 'microsoft-edge', 'Default')
    mkdirSync(edge, { recursive: true })
    writeFileSync(join(edge, 'Bookmarks'), '{}')
    expect(listSources({ platform: 'linux', home }).map((s) => s.browser)).toEqual(['edge', 'firefox'])
  })
})

describe('readSource', () => {
  it('reads a Chromium profile and turns a broken part into a warning', async () => {
    const profile = newDir('Default')
    writeFileSync(join(profile, 'Bookmarks'), fixture('chromium-Bookmarks.json'))
    writeFileSync(join(profile, 'History'), 'not a database at all, just text that is long enough to not be empty')
    const src = { browser: 'chrome' as const, browserName: 'Chrome', profileName: 'Default', profilePath: profile, isDefault: true, has: { bookmarks: true, history: true } }
    const data = await readSource(src)
    expect(countBookmarks(data.bookmarks).bookmarks).toBe(8)
    expect(data.history).toEqual([])
    expect(data.warnings).toHaveLength(1)
    expect(data.warnings[0]).toMatch(/^History: /)
    const onlyBookmarks = await readSource(src, { history: false })
    expect(onlyBookmarks.warnings).toEqual([])
  })

  it('reads a Firefox profile with one copy', async () => {
    const profile = newDir('ff.default')
    makePlaces(join(profile, 'places.sqlite')).close()
    const data = await readSource({ browser: 'firefox', browserName: 'Firefox', profileName: 'default', profilePath: profile, isDefault: true, has: { bookmarks: true, history: true } }, { historyLimit: 1 })
    expect(data.browser).toBe('firefox')
    expect(countBookmarks(data.bookmarks)).toEqual({ bookmarks: 3, folders: 1 })
    expect(data.history.map((h) => h.url)).toEqual(['https://mdn.example.org/'])
  })
})

describe('applyImport', () => {
  const chromeData = (): ImportData => ({ browser: 'chrome', bookmarks: parseChromiumBookmarks(JSON.parse(fixture('chromium-Bookmarks.json'))), history: [], warnings: [] })
  const NOW = Date.UTC(2026, 9, 24)

  it('makes a "Chrome bookmarks" space: toolbar at the top, other roots as folders, junk and dupes skipped', () => {
    const doc = freshDoc()
    const r = applyImport(doc, chromeData(), {}, NOW)
    const space = doc.spaces.find((s) => s.id === r.spaceId)!
    expect(space.title).toBe('Chrome bookmarks')
    expect(space.position).toBe(1)
    expect(r).toMatchObject({ bookmarks: 4, folders: 3, skipped: 4 }) // javascript:, chrome:, about:, duplicate Docs
    const items = doc.items.filter((i) => i.spaceId === space.id)
    expect(items.every((i) => i.section === 'pinned' && i.createdAt === NOW && i.lastActiveAt === NOW)).toBe(true)
    const top = items.filter((i) => i.parentId === null).sort((a, b) => a.position - b.position)
    expect(top.map((i) => [i.kind, i.title])).toEqual([
      ['tab', 'Docs'],
      ['folder', 'Research'],
      ['folder', 'Other bookmarks']
    ])
    const research = top[1]
    const kids = items.filter((i) => i.parentId === research.id).sort((a, b) => a.position - b.position)
    expect(kids.map((i) => i.title)).toEqual(['News', 'Nested'])
    expect(items.filter((i) => i.parentId === kids[1].id).map((i) => i.url)).toEqual(['https://deep.example.org/page?q=1'])
    expect(items.some((i) => i.title === 'Empty')).toBe(false)
    expect(JSON.stringify(items)).not.toMatch(/javascript:|chrome:|about:/)
  })

  it('a second import gets its own name; into an existing space it dedupes against what is there', () => {
    const doc = freshDoc()
    applyImport(doc, chromeData(), {}, NOW)
    const again = applyImport(doc, chromeData(), {}, NOW)
    expect(doc.spaces.find((s) => s.id === again.spaceId)!.title).toBe('Chrome bookmarks 2')

    const personal = doc.spaces[0].id
    doc.items.push({ id: 'i-x', spaceId: personal, parentId: null, kind: 'tab', section: 'pinned', url: 'https://docs.example.com/', position: 4, createdAt: 1, lastActiveAt: 1 })
    const into = applyImport(doc, chromeData(), { spaceId: personal }, NOW)
    expect(into.spaceId).toBe(personal)
    expect(into.bookmarks).toBe(3)
    const top = doc.items.filter((i) => i.spaceId === personal && i.parentId === null).sort((a, b) => a.position - b.position)
    expect(top.map((i) => i.position)).toEqual([4, 5, 6]) // after the existing tab
    expect(top.map((i) => i.title)).toEqual([undefined, 'Research', 'Other bookmarks'])
  })

  it('caps at MAX_BOOKMARKS and makes no space when nothing is left', () => {
    const many: BookmarkNode[] = [{ kind: 'folder', title: 'Bookmarks bar', root: 'toolbar', children: Array.from({ length: MAX_BOOKMARKS + 50 }, (_, i) => ({ kind: 'bookmark' as const, title: `B${i}`, url: `https://e${i}.example.com/` })) }]
    const doc = freshDoc()
    const r = applyImport(doc, { bookmarks: many, history: [], warnings: [] }, { spaceTitle: 'Lots' }, NOW)
    expect(r.bookmarks).toBe(MAX_BOOKMARKS)
    expect(r.skipped).toBe(50)
    expect(doc.spaces.find((s) => s.id === r.spaceId)!.title).toBe('Lots')

    const before = doc.spaces.length
    const none = applyImport(doc, { bookmarks: [{ kind: 'folder', title: 'x', root: 'other', children: [{ kind: 'bookmark', title: 'js', url: 'javascript:void 0' }] }], history: [], warnings: [] }, {}, NOW)
    expect(none.spaceId).toBeNull()
    expect(doc.spaces.length).toBe(before)
  })

  it('merges history: max visits, latest visit, newest first, capped at 5000', () => {
    const doc = freshDoc()
    doc.history = [
      { url: 'https://a.example.com/', title: 'A', lastVisit: 2000, visits: 9 },
      { url: 'https://b.example.com/', lastVisit: 5000, visits: 1 }
    ]
    const r = applyImport(doc, {
      bookmarks: [],
      warnings: [],
      history: [
        { url: 'https://a.example.com/', title: 'A2', visits: 3, lastVisit: 9000 },
        { url: 'https://b.example.com/', title: 'B', visits: 4, lastVisit: 1000 },
        { url: 'https://c.example.com/', visits: 2, lastVisit: 3000 },
        { url: 'ftp://d.example.com/', visits: 2, lastVisit: 3000 },
        { url: 'https://future.example.com/', visits: 1, lastVisit: NOW + 1e9 }
      ]
    }, {}, NOW)
    expect(r.history).toBe(4)
    expect(doc.history).toEqual([
      { url: 'https://future.example.com/', lastVisit: NOW, visits: 1 },
      { url: 'https://a.example.com/', title: 'A', lastVisit: 9000, visits: 9 },
      { url: 'https://b.example.com/', title: 'B', lastVisit: 5000, visits: 4 },
      { url: 'https://c.example.com/', lastVisit: 3000, visits: 2 }
    ])

    const big = Array.from({ length: 6000 }, (_, i) => ({ url: `https://h${i}.example.com/`, visits: 1, lastVisit: 10000 + i }))
    const capped = applyImport(doc, { bookmarks: [], warnings: [], history: big }, {}, NOW)
    expect(doc.history).toHaveLength(5000)
    expect(capped.history).toBe(4999) // the future-dated entry still ranks first
    expect(doc.history[1].url).toBe('https://h5999.example.com/')
  })
})

describe('passwords CSV', () => {
  it('parses RFC 4180 quoting: commas, doubled quotes, line breaks, CRLF and BOM', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","line1\r\nline2"\r\n\r\nplain,,"" \n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\r\nline2'],
      ['plain', '', ' ']
    ])
  })

  it('Chrome/Edge/Brave export', () => {
    const r = parsePasswordsCsv(fixture('passwords-chrome.csv'))
    expect(r.format).toBe('chromium')
    expect(r.entries).toEqual([
      { origin: 'https://accounts.example.com', username: 'alice@example.com', password: 'pa,ss"word' },
      { origin: 'https://shop.example.net', username: 'bob', password: 'multi\nline, secret' },
      { origin: 'https://localhost:8443', username: 'dev', password: 'devpass' }
    ])
    expect(r.skipped).toBe(3) // android app, no password, duplicate
    const crlf = parsePasswordsCsv('﻿' + fixture('passwords-chrome.csv').replace(/\n/g, '\r\n'))
    expect(crlf.entries.map((e) => e.origin)).toEqual(r.entries.map((e) => e.origin))
  })

  it('Firefox export', () => {
    const r = parsePasswordsCsv(fixture('passwords-firefox.csv'))
    expect(r.format).toBe('firefox')
    expect(r.entries).toEqual([
      { origin: 'https://mail.example.com', username: 'erin', password: 'quote"inside' },
      { origin: 'http://intranet.example.test:8080', username: '', password: 'only-pass' }
    ])
    expect(r.skipped).toBe(1) // chrome://FirefoxAccounts
  })

  it('Bitwarden and 1Password exports', () => {
    const bw = parsePasswordsCsv(fixture('passwords-bitwarden.csv'))
    expect(bw.format).toBe('bitwarden')
    expect(bw.entries).toEqual([
      { origin: 'https://git.example.com', username: 'frank', password: '  spaced pass  ' },
      { origin: 'https://vault.example.com', username: 'grace', password: 'gracepass' }
    ])
    expect(bw.skipped).toBe(1) // secure note
    const op = parsePasswordsCsv(fixture('passwords-1password.csv'))
    expect(op).toEqual({ format: 'generic', entries: [{ origin: 'https://forum.example.com', username: 'heidi', password: 'hpass' }], skipped: 0 })
  })

  it('origins and bad files', () => {
    expect(originOf('example.com/login')).toBe('https://example.com')
    expect(originOf('localhost:3000')).toBe('https://localhost:3000')
    expect(originOf('android://abc@com.app/')).toBeNull()
    expect(originOf('')).toBeNull()
    expect(() => parsePasswordsCsv('')).toThrow(/empty/)
    expect(() => parsePasswordsCsv('title,notes\nx,y\n')).toThrow(/columns/)
  })
})
