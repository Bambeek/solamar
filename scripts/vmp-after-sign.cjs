// electron-builder afterSign: on Windows the VMP signature goes on after code signing and after the icon and version
// info are written into Solamar.exe, both of which would break it (see vmp.cjs). electron-builder calls this even
// for unsigned Windows builds, because it still edits the exe.
const { vmpSign } = require('./vmp.cjs')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName === 'win32') vmpSign(context.appOutDir)
}
