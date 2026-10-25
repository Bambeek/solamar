// Widevine VMP signing with castLabs' EVS service (free account: `python3 -m castlabs_evs.account signup`). Without
// it Widevine still loads, but only license servers that accept development clients play; Netflix and the like want
// a production signature. Runs when EVS_ACCOUNT_NAME and EVS_PASSWD are set (CI secrets), else says so and skips.
// The order matters: macOS signs for VMP before code signing (afterPack), Windows after it (afterSign).
const { execFileSync } = require('node:child_process')

const python = process.env.EVS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')

/** @param {string} appOutDir the folder holding Solamar.exe or Solamar.app */
exports.vmpSign = function vmpSign(appOutDir) {
  if (process.env.SOLAMAR_PERSONAL_BUILD === '1') return console.log('  • VMP signing skipped: personal build')
  if (!process.env.EVS_ACCOUNT_NAME || !process.env.EVS_PASSWD) {
    return console.log('  • VMP signing skipped: no EVS_ACCOUNT_NAME / EVS_PASSWD (DRM plays only on development license servers)')
  }
  // EVS reads EVS_ACCOUNT_NAME and EVS_PASSWD itself, so the password stays out of the command line.
  const env = { ...process.env, EVS_NO_ASK: '1' }
  const run = (...args) => execFileSync(python, ['-m', ...args], { stdio: 'inherit', env })
  run('castlabs_evs.account', 'reauth')
  run('castlabs_evs.vmp', 'sign-pkg', appOutDir)
  console.log(`  • VMP signed ${appOutDir}`)
}
