// Minimal reader for Apple binary property lists (bplist00), enough for Safari's Bookmarks.plist.
// Format: "bplist00" header, objects, an offset table, and a 32-byte trailer at the end.
import { ImportError } from './types'

export interface PlistUid {
  UID: number
}

const fail = (why: string): never => {
  throw new ImportError(`Malformed binary plist: ${why}`)
}

const APPLE_EPOCH_MS = 978307200000 // 2001-01-01 UTC

// fromCharCode in chunks: spreading a long URL into one call can overflow the stack.
function fromCodes(codes: Uint8Array | Uint16Array): string {
  let s = ''
  for (let i = 0; i < codes.length; i += 8192) s += String.fromCharCode(...codes.subarray(i, i + 8192))
  return s
}

export function parseBplist(buf: Uint8Array): unknown {
  if (buf.length < 40) fail('too short')
  const magic = fromCodes(buf.subarray(0, 8))
  if (magic !== 'bplist00') fail(magic.startsWith('<?xml') || magic.startsWith('<plist') ? 'XML plist, not binary' : 'bad header')
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  const uint = (pos: number, size: number): number => {
    if (pos < 0 || pos + size > buf.length) fail('read past end')
    if (size === 1) return view.getUint8(pos)
    if (size === 2) return view.getUint16(pos)
    if (size === 4) return view.getUint32(pos)
    if (size === 8) {
      const v = view.getBigUint64(pos)
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) fail('integer too large')
      return Number(v)
    }
    // UIDs may use 3, 5, 6 or 7 bytes
    let n = 0
    for (let i = 0; i < size; i++) n = n * 256 + view.getUint8(pos + i)
    return n
  }

  const t = buf.length - 32
  const offsetSize = view.getUint8(t + 6)
  const refSize = view.getUint8(t + 7)
  const count = uint(t + 8, 8)
  const top = uint(t + 16, 8)
  const tableAt = uint(t + 24, 8)
  if (!offsetSize || !refSize || top >= count || tableAt + count * offsetSize > t) fail('bad trailer')

  const offsetOf = (i: number) => {
    if (i >= count) fail('object reference out of range')
    return uint(tableAt + i * offsetSize, offsetSize)
  }

  // Objects may be shared; caching them keeps a crafted file from expanding exponentially.
  const done = new Map<number, unknown>()
  const active = new Set<number>()
  const read = (index: number, depth: number): unknown => {
    if (done.has(index)) return done.get(index)
    if (depth > 256) fail('nested too deep')
    if (active.has(index)) fail('reference cycle')
    active.add(index)
    try {
      const v = readAt(offsetOf(index), depth)
      done.set(index, v)
      return v
    } finally {
      active.delete(index)
    }
  }

  // Length in the marker's low nibble, or 0xF and an int object right after it.
  const lengthAt = (pos: number, info: number): [len: number, start: number] => {
    if (info !== 0xf) return [info, pos + 1]
    const m = uint(pos + 1, 1)
    if (m >> 4 !== 0x1) fail('bad length')
    const size = 1 << (m & 0xf)
    return [uint(pos + 2, size), pos + 2 + size]
  }

  const readAt = (pos: number, depth: number): unknown => {
    const marker = uint(pos, 1)
    const type = marker >> 4
    const info = marker & 0xf
    switch (type) {
      case 0x0:
        if (info === 0x8) return false
        if (info === 0x9) return true
        return null
      case 0x1: {
        const size = 1 << info
        if (size === 8) return Number(view.getBigInt64(pos + 1))
        if (size === 16) return Number(view.getBigInt64(pos + 9)) // low 8 bytes
        return uint(pos + 1, size)
      }
      case 0x2:
        if (info === 2) return view.getFloat32(pos + 1)
        if (info === 3) return view.getFloat64(pos + 1)
        return fail('bad real')
      case 0x3:
        return new Date(APPLE_EPOCH_MS + view.getFloat64(pos + 1) * 1000)
      case 0x4: {
        const [len, start] = lengthAt(pos, info)
        if (start + len > t) fail('data past end')
        return buf.slice(start, start + len)
      }
      case 0x5: {
        const [len, start] = lengthAt(pos, info)
        if (start + len > t) fail('string past end')
        return fromCodes(buf.subarray(start, start + len))
      }
      case 0x6: {
        const [len, start] = lengthAt(pos, info)
        if (start + len * 2 > t) fail('string past end')
        const units = new Uint16Array(len)
        for (let i = 0; i < len; i++) units[i] = view.getUint16(start + i * 2)
        return fromCodes(units)
      }
      case 0x8:
        return { UID: uint(pos + 1, info + 1) } satisfies PlistUid
      case 0xa:
      case 0xc: {
        const [len, start] = lengthAt(pos, info)
        const out: unknown[] = []
        for (let i = 0; i < len; i++) out.push(read(uint(start + i * refSize, refSize), depth + 1))
        return out
      }
      case 0xd: {
        const [len, start] = lengthAt(pos, info)
        const out: Record<string, unknown> = {}
        for (let i = 0; i < len; i++) {
          const key = read(uint(start + i * refSize, refSize), depth + 1)
          const value = read(uint(start + (len + i) * refSize, refSize), depth + 1)
          out[String(key)] = value
        }
        return out
      }
      default:
        return fail(`unknown object type 0x${type.toString(16)}`)
    }
  }

  try {
    return read(top, 0)
  } catch (e) {
    if (e instanceof ImportError) throw e
    return fail('read past end') // DataView RangeError on a truncated object
  }
}
