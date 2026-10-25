// electron-builder afterPack: on macOS the VMP signature goes on before code signing (see vmp.cjs).
const { vmpSign } = require('./vmp.cjs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') vmpSign(context.appOutDir)
}
