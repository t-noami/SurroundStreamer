const { existsSync, renameSync, writeFileSync, chmodSync } = require('fs')
const { join } = require('path')
const { spawnSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    embedWindowsIcon(context)
    return
  }
  if (context.electronPlatformName === 'linux') {
    wrapLinuxLauncherForSandbox(context)
    return
  }
}

function embedWindowsIcon(context) {
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

// AppImage cannot ship a SUID chrome-sandbox, and Ubuntu 24.04+ blocks the
// namespace fallback via apparmor_restrict_unprivileged_userns. Wrap the
// Electron binary so launches always pass --no-sandbox.
function wrapLinuxLauncherForSandbox(context) {
  const exeName = context.packager.executableName || 'surround-streamer'
  const exePath = join(context.appOutDir, exeName)
  const realPath = join(context.appOutDir, `${exeName}-bin`)
  if (!existsSync(exePath)) {
    throw new Error(`Linux sandbox wrapper: expected binary at ${exePath}`)
  }
  renameSync(exePath, realPath)
  const wrapper = `#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/${exeName}-bin" --no-sandbox "$@"
`
  writeFileSync(exePath, wrapper, { mode: 0o755 })
  chmodSync(exePath, 0o755)
}
