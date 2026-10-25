// Builds the app and its installer for the system this runs on: the NSIS installer on Windows, disk images (Apple
// silicon and Intel) on macOS. --personal: a build for your own computer that may run AI features on your Claude
// Code plan (Anthropic does not allow offering plan usage in products for others, so public builds leave it out).
// --publish: upload to the draft GitHub release for this version (CI on a v* tag; needs GH_TOKEN). Never personal.
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const personal = process.argv.includes('--personal')
const publish = process.argv.includes('--publish')
if (personal && publish) throw new Error('Personal builds are for your own computer; they are never published.')
const mac = process.platform === 'darwin'
const env = { ...process.env, SOLAMAR_PERSONAL_BUILD: personal ? '1' : '' }
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env })
run('npx electron-vite build')
const name = mac ? ' -c.dmg.artifactName=Solamar-Personal-${arch}.${ext}' : ' -c.nsis.artifactName=Solamar-Personal-Setup.${ext}'
// Windows packs the Electron in node_modules (fetched on first use, so a fresh install may not have it yet); macOS
// downloads one per architecture.
if (!mac && !existsSync('node_modules/electron/dist')) run('node node_modules/electron/install.js')
const target = mac ? '--mac' : '--win -c.electronDist=node_modules/electron/dist'
run(`npx electron-builder ${target} --publish ${publish ? 'always' : 'never'}${personal ? name : ''}`)
