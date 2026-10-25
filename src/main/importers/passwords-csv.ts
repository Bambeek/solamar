// Saved passwords come in as the CSV file a browser or password manager exports. Chrome/Edge 127+
// encrypt Login Data with app-bound keys, so reading it directly is not an option (and not wanted).
// Nothing here may log field values: they are passwords.

export interface PasswordEntry {
  origin: string // scheme + host (+ port), e.g. https://accounts.example.com
  username: string
  password: string
}

export type PasswordCsvFormat = 'chromium' | 'firefox' | 'bitwarden' | 'generic'

export interface PasswordCsvResult {
  format: PasswordCsvFormat
  entries: PasswordEntry[]
  skipped: number // rows without a web origin or a password, non-login items, exact duplicates
}

export class PasswordCsvError extends Error {}

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let wasQuoted = false
  const endField = () => {
    row.push(field)
    field = ''
    wasQuoted = false
  }
  const endRow = () => {
    endField()
    if (row.some((f) => f !== '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (s[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === '"' && field === '' && !wasQuoted) {
      quoted = true
      wasQuoted = true
    } else if (c === ',') endField()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      endRow()
    } else field += c
  }
  if (field !== '' || row.length) endRow()
  return rows
}

// Header names seen in exports, best match first.
const URL_COLS = ['url', 'login_uri', 'website', 'web site', 'login url', 'uri', 'origin', 'hostname', 'address']
const USER_COLS = ['username', 'login_username', 'user name', 'login name', 'user', 'login', 'email', 'e-mail']
const PASS_COLS = ['password', 'login_password', 'pass']

/** scheme + host of a web login, or null (android://, chrome://FirefoxAccounts, notes...). */
export function originOf(raw: string): string | null {
  let u = raw.trim().split(/[\s,]+/)[0] // Bitwarden may list several URIs in one cell
  if (!u) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u
  try {
    const x = new URL(u)
    return (x.protocol === 'https:' || x.protocol === 'http:') && x.hostname ? x.origin : null
  } catch {
    return null
  }
}

export function parsePasswordsCsv(text: string): PasswordCsvResult {
  const rows = parseCsv(text)
  if (rows.length && rows[0].length === 1 && /^sep=.$/i.test(rows[0][0])) rows.shift() // Excel's separator hint
  if (!rows.length) throw new PasswordCsvError('The file is empty.')
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col = (names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n)
      if (i >= 0) return i
    }
    return -1
  }
  const urlCol = col(URL_COLS)
  const userCol = col(USER_COLS)
  const passCol = col(PASS_COLS)
  if (urlCol < 0 || passCol < 0) throw new PasswordCsvError('No url and password columns found. Export passwords as CSV from your browser or password manager.')

  const format: PasswordCsvFormat = header.includes('httprealm') || header.includes('formactionorigin')
    ? 'firefox'
    : header.includes('login_uri')
      ? 'bitwarden'
      : header.slice(0, 4).join(',') === 'name,url,username,password'
        ? 'chromium'
        : 'generic'
  const typeCol = format === 'bitwarden' ? header.indexOf('type') : -1

  const entries: PasswordEntry[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const r of rows.slice(1)) {
    const type = typeCol >= 0 ? (r[typeCol] ?? '').trim().toLowerCase() : ''
    const origin = originOf(r[urlCol] ?? '')
    const password = r[passCol] ?? ''
    const username = userCol >= 0 ? (r[userCol] ?? '') : ''
    const key = JSON.stringify([origin, username, password])
    if ((type && type !== 'login') || !origin || !password || seen.has(key)) {
      skipped++
      continue
    }
    seen.add(key)
    entries.push({ origin, username, password })
  }
  return { format, entries, skipped }
}
