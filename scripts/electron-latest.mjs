// Which castLabs Electron releases Solamar should move to, for .github/workflows/electron.yml. Prints GitHub step
// outputs: patch=<newest stable release of the major Solamar is on, if newer> and major=<newest stable release of a
// newer major, if any>, e.g. "patch=44.9.4+wvcus". Reads the tag from package.json's electron dependency.
import { readFileSync } from 'node:fs'

const spec = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies.electron
const m = /#v(\d+\.\d+\.\d+\+wvcus)$/.exec(spec)
if (!m) throw new Error(`electron is not a castLabs release tag: ${spec}`)
const parse = (v) => v.replace(/\+.*/, '').split('.').map(Number)
const newer = (a, b) => {
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}
const current = m[1]
const headers = { accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
const releases = []
for (let page = 1; page <= 3; page++) {
  const res = await fetch(`https://api.github.com/repos/castlabs/electron-releases/releases?per_page=100&page=${page}`, { headers })
  if (!res.ok) throw new Error(`castLabs releases: HTTP ${res.status}`)
  const batch = await res.json()
  releases.push(...batch)
  if (batch.length < 100) break
}
const stable = releases
  .filter((r) => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+\+wvcus$/.test(r.tag_name))
  .map((r) => r.tag_name.slice(1))
const best = (list) => list.reduce((a, v) => (a === null || newer(v, a) ? v : a), null)
const major = parse(current)[0]
const patch = best(stable.filter((v) => parse(v)[0] === major && newer(v, current)))
const next = best(stable.filter((v) => parse(v)[0] > major))
console.log(`current=${current}`)
console.log(`patch=${patch ?? ''}`)
console.log(`major=${next ?? ''}`)
