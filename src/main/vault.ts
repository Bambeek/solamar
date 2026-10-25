// Saved passwords. On disk: one blob encrypted with the OS keychain via safeStorage (DPAPI on Windows, Keychain on
// macOS, libsecret on Linux). Inside it, every password is encrypted again (AES-256-GCM) with a random vault key; the
// sites and usernames are not, so the login list works while the vault is locked. Without a master password the vault
// key is kept inside the keychain blob. With one, it is wrapped with a key derived from the master password (scrypt)
// and held in memory only while the vault is unlocked; Solamar never stores the master password. Passwords are
// decrypted one at a time, when one is filled, shown or copied. Not in solamar.json, never logged.
import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'
import { uid } from '@shared/util'
import type { LoginInfo } from '@shared/types'

export interface Login extends LoginInfo {
  password: string
}

/** A login as kept in memory and on disk: the password sealed with the vault key. */
interface Entry extends LoginInfo {
  pw: string
}

interface MasterLock {
  kdf: 'scrypt'
  salt: string
  N: number
  r: number
  p: number
  wrapped: string // the vault key, sealed with the key derived from the master password
}

interface Payload {
  v: 2
  key?: string // the vault key when there is no master password
  master?: MasterLock
  entries: Entry[]
}

export class VaultLockedError extends Error {
  constructor() {
    super('Unlock your saved passwords first.')
  }
}

/** scheme://host[:port] of a page or form address, '' when it is not a web address. */
export function originOf(url: string): string {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.origin : ''
  } catch {
    return ''
  }
}

// scrypt cost: 2^17 x 8 x 128 bytes = 128 MB and about half a second, so guessing a master password from a stolen
// file is slow. Stored per vault, so it can be raised later without breaking older files.
const KDF = { N: 2 ** 17, r: 8, p: 1 }
export const MIN_MASTER_LENGTH = 8

function seal(key: Buffer, text: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')
}

function open(key: Buffer, sealed: string): string {
  const buf = Buffer.from(sealed, 'base64')
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

function derive(password: string, lock: Pick<MasterLock, 'salt' | 'N' | 'r' | 'p'>): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), Buffer.from(lock.salt, 'base64'), 32, { N: lock.N, r: lock.r, p: lock.p, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  )
}

const info = ({ pw: _pw, ...rest }: Entry): LoginInfo => rest

export class Vault {
  private entries: Entry[] = []
  private key: Buffer | null = null // null while locked
  private master: MasterLock | undefined
  private ok = false
  private writing: Promise<void> = Promise.resolve()
  private failures = 0
  private retryAt = 0

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    this.ok = await safeStorage.isAsyncEncryptionAvailable().catch(() => false)
    if (!this.ok) return
    if (!existsSync(this.file)) {
      this.key = randomBytes(32)
      return
    }
    try {
      const { data } = JSON.parse(readFileSync(this.file, 'utf-8')) as { data: string }
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(data, 'base64'))
      const parsed = JSON.parse(result) as Payload | Login[]
      if (Array.isArray(parsed)) {
        // Version 1: the passwords themselves inside the keychain blob. Seal each with a new vault key.
        this.key = randomBytes(32)
        this.entries = parsed.map(({ password, ...rest }) => ({ ...rest, pw: seal(this.key!, password) }))
        await this.write()
      } else {
        this.master = parsed.master
        this.entries = Array.isArray(parsed.entries) ? parsed.entries : []
        this.key = parsed.key ? Buffer.from(parsed.key, 'base64') : null
        if (shouldReEncrypt) await this.write()
      }
    } catch {
      // Unreadable (keychain changed or file damaged): keep it aside rather than overwrite it.
      try {
        renameSync(this.file, this.file + '.unreadable-' + Date.now())
      } catch {}
      this.entries = []
      this.master = undefined
      this.key = randomBytes(32)
    }
  }

  get available(): boolean {
    return this.ok
  }

  get count(): number {
    return this.entries.length
  }

  /** A master password is set and the vault key is not in memory. */
  get locked(): boolean {
    return !this.key
  }

  get hasMaster(): boolean {
    return !!this.master
  }

  private needKey(): Buffer {
    if (!this.key) throw new VaultLockedError()
    return this.key
  }

  list(query = ''): LoginInfo[] {
    const q = query.trim().toLowerCase()
    return this.entries
      .filter((l) => !q || l.origin.toLowerCase().includes(q) || l.username.toLowerCase().includes(q))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username))
      .map(info)
  }

  forOrigin(origin: string): LoginInfo[] {
    return this.entries.filter((l) => l.origin === origin).sort((a, b) => (b.lastUsedAt ?? b.updatedAt) - (a.lastUsedAt ?? a.updatedAt)).map(info)
  }

  info(id: string): LoginInfo | undefined {
    const e = this.entries.find((l) => l.id === id)
    return e && info(e)
  }

  /** One login with its password, decrypted now. Throws VaultLockedError while locked. */
  get(id: string): Login | undefined {
    const e = this.entries.find((l) => l.id === id)
    if (!e) return undefined
    return { ...info(e), password: open(this.needKey(), e.pw) }
  }

  /** What saving this login would do: nothing new, a new entry, a changed password, or unknown while locked. */
  check(origin: string, username: string, password: string): 'same' | 'new' | 'update' | 'locked' {
    const e = this.entries.find((x) => x.origin === origin && x.username === username)
    if (!e) return 'new'
    if (!this.key) return 'locked'
    const a = Buffer.from(open(this.key, e.pw))
    const b = Buffer.from(password)
    return a.length === b.length && timingSafeEqual(a, b) ? 'same' : 'update'
  }

  async save(origin: string, username: string, password: string): Promise<'added' | 'updated' | 'same'> {
    if (!this.ok) throw new Error('This computer has no usable keychain, so Solamar will not store passwords.')
    const key = this.needKey()
    const kind = this.check(origin, username, password)
    if (kind === 'same') return 'same'
    const now = Date.now()
    const e = this.entries.find((x) => x.origin === origin && x.username === username)
    if (e) Object.assign(e, { pw: seal(key, password), updatedAt: now })
    else this.entries.push({ id: uid('pw-'), origin, username, pw: seal(key, password), createdAt: now, updatedAt: now })
    await this.write()
    return e ? 'updated' : 'added'
  }

  async update(id: string, patch: { username?: string; password?: string }): Promise<boolean> {
    const e = this.entries.find((l) => l.id === id)
    if (!e) return false
    if (patch.password) e.pw = seal(this.needKey(), patch.password)
    if (patch.username !== undefined) e.username = patch.username
    e.updatedAt = Date.now()
    await this.write()
    return true
  }

  async remove(id: string): Promise<void> {
    this.entries = this.entries.filter((l) => l.id !== id)
    await this.write()
  }

  markUsed(id: string): void {
    const e = this.entries.find((l) => l.id === id)
    if (!e) return
    e.lastUsedAt = Date.now()
    void this.write()
  }

  async importEntries(entries: { origin: string; username: string; password: string }[]): Promise<{ added: number; updated: number; same: number }> {
    if (!this.ok) throw new Error('This computer has no usable keychain, so Solamar will not store passwords.')
    const key = this.needKey()
    const out = { added: 0, updated: 0, same: 0 }
    const now = Date.now()
    for (const n of entries) {
      const origin = originOf(n.origin)
      if (!origin || !n.password) continue
      const kind = this.check(origin, n.username, n.password)
      const e = this.entries.find((x) => x.origin === origin && x.username === n.username)
      if (kind === 'same') out.same++
      else if (e) Object.assign(e, { pw: seal(key, n.password), updatedAt: now }), out.updated++
      else this.entries.push({ id: uid('pw-'), origin, username: n.username, pw: seal(key, n.password), createdAt: now, updatedAt: now }), out.added++
    }
    if (out.added || out.updated) await this.write()
    return out
  }

  // ---------- master password ----------

  /** Unlocks with the master password. Wrong guesses wait longer each time (1, 2, 4... up to 30 s). */
  async unlock(password: string): Promise<boolean> {
    if (!this.master) return true
    if (this.key) return true
    const wait = this.retryAt - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    try {
      const kek = await derive(password, this.master)
      this.key = Buffer.from(open(kek, this.master.wrapped), 'base64')
      kek.fill(0)
      this.failures = 0
      return true
    } catch {
      this.failures++
      this.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** (this.failures - 1))
      return false
    }
  }

  /** Forgets the vault key; only possible with a master password (otherwise there is nothing to unlock it with). */
  lock(): void {
    if (!this.master || !this.key) return
    this.key.fill(0)
    this.key = null
  }

  /** Sets or changes the master password. Changing it needs the vault unlocked (with the current one). */
  async setMaster(password: string): Promise<void> {
    if (password.length < MIN_MASTER_LENGTH) throw new Error(`Use at least ${MIN_MASTER_LENGTH} characters.`)
    const key = this.needKey()
    const lock = { kdf: 'scrypt' as const, salt: randomBytes(16).toString('base64'), ...KDF }
    const kek = await derive(password, lock)
    this.master = { ...lock, wrapped: seal(kek, key.toString('base64')) }
    kek.fill(0)
    await this.write()
  }

  /** Removes the master password: the vault key goes back into the keychain blob. Needs the current password. */
  async removeMaster(password: string): Promise<boolean> {
    if (!this.master) return true
    if (!(await this.verifyMaster(password))) return false
    this.master = undefined
    await this.write()
    return true
  }

  /** Is this the master password? (Re-asked before showing a password when the system cannot confirm it is you.) */
  async verifyMaster(password: string): Promise<boolean> {
    if (!this.master) return false
    try {
      const kek = await derive(password, this.master)
      const key = Buffer.from(open(kek, this.master.wrapped), 'base64')
      kek.fill(0)
      if (!this.key) this.key = key
      return true
    } catch {
      this.failures++
      this.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** (this.failures - 1))
      return false
    }
  }

  /** Writes one at a time, newest content last. */
  private write(): Promise<void> {
    this.writing = this.writing.catch(() => {}).then(async () => {
      const payload: Payload = { v: 2, entries: this.entries }
      if (this.master) payload.master = this.master
      else if (this.key) payload.key = this.key.toString('base64')
      const enc = await safeStorage.encryptStringAsync(JSON.stringify(payload))
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, JSON.stringify({ v: 2, data: enc.toString('base64') }))
      renameSync(tmp, this.file)
    })
    return this.writing
  }
}
