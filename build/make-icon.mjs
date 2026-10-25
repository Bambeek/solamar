// Renders build/icon.svg (and the simplified small variant for <= 32 px) to PNGs and a multi-size Windows .ico,
// then every icon a user can pick in Settings > Appearance (src/renderer/src/assets/app-icons/*.svg) to build/icons/.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]

function writeIco(big, small, file) {
  const pngs = sizes.map((s) => new Resvg(s <= 32 ? small : big, { fitTo: { mode: 'width', value: s } }).render().asPng())
  // ICO: 6-byte header, 16-byte entry per image, then the PNG data (PNG-compressed entries, Vista+).
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = 6 + 16 * sizes.length
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    return e
  })
  writeFileSync(file, Buffer.concat([header, ...entries, ...pngs]))
}

const big = readFileSync('build/icon.svg', 'utf8')
const small = readFileSync('build/icon-small.svg', 'utf8')
writeFileSync('build/icon.png', new Resvg(big, { fitTo: { mode: 'width', value: 512 } }).render().asPng())
writeIco(big, small, 'build/icon.ico')
console.log('icon.ico', sizes.join(','), 'icon.png 512')

const dir = 'src/renderer/src/assets/app-icons'
mkdirSync('build/icons', { recursive: true })
for (const f of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
  const id = f.slice(0, -4)
  const svg = readFileSync(`${dir}/${f}`, 'utf8')
  writeFileSync(`build/icons/${id}.png`, new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng())
  writeIco(svg, svg, `build/icons/${id}.ico`)
  console.log(`icons/${id}.ico`)
}
