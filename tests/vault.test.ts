import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for the OS keychain: reversible, and marks its output so a test can tell the layer is there.
vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (s: string) => Buffer.from('KEYCHAIN:' + Buffer.from(s).toString('base64')),
    decryptStringAsync: async (b: Buffer) => {
      const t = b.toString()
      if (!t.startsWith('KEYCHAIN:')) throw new Error('not ours')
      return { result: Buffer.from(t.slice(9), 'base64').toString(), shouldReEncrypt: false }
    }
  }
}))
const { Vault, VaultLockedError } = await import('../src/main/vault')

let file: string
const inside = () => {
  const { data } = JSON.parse(readFileSync(file, 'utf-8'))
  return JSON.parse(Buffer.from(Buffer.from(data, 'base64').toString().slice(9), 'base64').toString())
}
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'vault-')), 'passwords.json')
})

describe('vault', () => {
  it('keeps each password sealed inside the keychain blob', async () => {
    const v = new Vault(file)
    await v.init()
    await v.save('https://a.test', 'ann', 'secret-1')
    const p = inside()
    expect(p.v).toBe(2)
    expect(JSON.stringify(p)).not.toContain('secret-1')
    expect(p.entries[0].username).toBe('ann')
    expect(v.get(p.entries[0].id)?.password).toBe('secret-1')
  })

  it('moves a version 1 file (plain passwords in the blob) to sealed entries', async () => {
    const v1 = [{ id: 'pw-1', origin: 'https://a.test', username: 'ann', password: 'old-pass', createdAt: 1, updatedAt: 1 }]
    writeFileSync(file, JSON.stringify({ v: 1, data: Buffer.from('KEYCHAIN:' + Buffer.from(JSON.stringify(v1)).toString('base64')).toString('base64') }))
    const v = new Vault(file)
    await v.init()
    expect(JSON.stringify(inside())).not.toContain('old-pass')
    expect(v.get('pw-1')?.password).toBe('old-pass')
  })

  it('with a master password: locked after a restart, opens only with the right one', async () => {
    const v = new Vault(file)
    await v.init()
    await v.save('https://a.test', 'ann', 'secret-1')
    await v.setMaster('correct horse')
    expect(JSON.stringify(inside())).not.toMatch(/"key"/)

    const again = new Vault(file)
    await again.init()
    expect(again.locked).toBe(true)
    expect(again.list()).toHaveLength(1) // sites and usernames still listed
    const id = again.list()[0].id
    expect(() => again.get(id)).toThrow(VaultLockedError)
    expect(await again.unlock('wrong one')).toBe(false)
    expect(again.locked).toBe(true)
    expect(await again.unlock('correct horse')).toBe(true)
    expect(again.get(id)?.password).toBe('secret-1')
    again.lock()
    expect(again.locked).toBe(true)
  }, 20_000)

  it('refuses to save while locked, and can drop the master password again', async () => {
    const v = new Vault(file)
    await v.init()
    await v.setMaster('correct horse')
    v.lock()
    await expect(v.save('https://b.test', 'bob', 'x')).rejects.toThrow(VaultLockedError)
    expect(await v.removeMaster('nope')).toBe(false)
    expect(await v.removeMaster('correct horse')).toBe(true)
    const again = new Vault(file)
    await again.init()
    expect(again.locked).toBe(false)
  }, 20_000)

  it('rejects a short master password', async () => {
    const v = new Vault(file)
    await v.init()
    await expect(v.setMaster('short')).rejects.toThrow()
  })
})
