// Secrets (the user's Anthropic API key, the MCP bearer secret) encrypted with the OS keychain via safeStorage
// (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Never stored in solamar.json, never sent to a renderer.
// Decrypted once at startup (init) into memory; writes are encrypted asynchronously.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'

type Name = 'anthropicKey' | 'mcpSecret'

export class Secrets {
  private cache = new Map<Name, string>()
  private ok = false

  constructor(private readonly file: string) {}

  /** Call once after app ready, before anything reads a secret. */
  async init(): Promise<void> {
    this.ok = await safeStorage.isAsyncEncryptionAvailable().catch(() => false)
    if (!this.ok) return
    for (const [name, enc] of Object.entries(this.readAll()) as [Name, string][]) {
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(enc, 'base64'))
        this.cache.set(name, result)
        if (shouldReEncrypt) await this.set(name, result)
      } catch {
        // Unreadable (keychain changed): treat as missing.
      }
    }
  }

  get available(): boolean {
    return this.ok
  }

  private readAll(): Record<string, string> {
    if (!existsSync(this.file)) return {}
    try {
      return JSON.parse(readFileSync(this.file, 'utf-8'))
    } catch {
      return {}
    }
  }

  get(name: Name): string | null {
    return this.cache.get(name) ?? null
  }

  has(name: Name): boolean {
    return this.cache.has(name)
  }

  async set(name: Name, value: string | null): Promise<void> {
    if (value !== null && !this.ok) throw new Error('This computer has no usable keychain, so Solamar will not store the key.')
    const all = this.readAll()
    if (value === null) {
      delete all[name]
      this.cache.delete(name)
    } else {
      all[name] = (await safeStorage.encryptStringAsync(value)).toString('base64')
      this.cache.set(name, value)
    }
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(all))
    renameSync(tmp, this.file)
  }

  /** The MCP bearer secret, created on first use (kept for this session only when there is no keychain). */
  mcpSecret(): string {
    let s = this.get('mcpSecret')
    if (!s) {
      s = randomBytes(24).toString('base64url')
      this.cache.set('mcpSecret', s)
      if (this.ok) void this.set('mcpSecret', s)
    }
    return s
  }
}
