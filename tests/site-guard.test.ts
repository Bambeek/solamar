import { describe, expect, it } from 'vitest'
import { matchHost, parseHosts } from '../src/main/site-guard'

describe('parseHosts', () => {
  it('reads hosts files and plain lists, dropping comments, blanks and localhost', () => {
    const text = '# Title: Phishing Hosts Blocklist\n0.0.0.0 Login-Bank.example.top\n\n127.0.0.1 localhost\nevil.example # trailing note\n0.0.0.0 nodot\n'
    expect(parseHosts(text)).toEqual(['login-bank.example.top', 'evil.example'])
  })
})

describe('matchHost', () => {
  const listed = new Set(['evil.example', 'paypa1-login.weebly.com'])
  const has = (h: string) => listed.has(h)
  it('matches the host and its subdomains', () => {
    expect(matchHost('evil.example', has)).toBe('evil.example')
    expect(matchHost('www.secure.EVIL.example.', has)).toBe('evil.example')
  })
  it('does not match parents or lookalikes of a listed host', () => {
    expect(matchHost('weebly.com', has)).toBeNull()
    expect(matchHost('other.weebly.com', has)).toBeNull()
    expect(matchHost('notevil.example', has)).toBeNull()
  })
})
