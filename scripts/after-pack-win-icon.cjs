const { existsSync } = require('fs')
const { join } = require('path')
const { spawnSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = join(context.appOutDir, exeName)
  const iconPath = join(context.packager.projectDir, 'build', 'icon.ico')
  const rceditPath = join(
    context.packager.projectDir,
    'node_modules',
    'electron-winstaller',
    'vendor',
    'rcedit.exe'
  )

  for (const path of [exePath, iconPath, rceditPath]) {
    if (!existsSync(path)) {
      throw new Error(`Windows icon resource step could not find: ${path}`)
    }
  }

  const result = spawnSync(rceditPath, [exePath, '--set-icon', iconPath], {
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.status !== 0) {
    throw new Error(
      `rcedit failed while embedding Windows icon: ${result.stderr || result.stdout || result.error?.message || 'unknown error'}`
    )
  }
}
