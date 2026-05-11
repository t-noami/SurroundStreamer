import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
let cachedFfmpegPath = null

export function getFfmpegPath() {
  if (cachedFfmpegPath) return cachedFfmpegPath

  const candidate = ffmpegCandidates().find(isExecutableFile)
  if (!candidate) {
    throw new Error(
      [
        'FFmpeg binary is not available.',
        'Set SURROUNDSTREAMER_FFMPEG_PATH or place a vetted binary at',
        `resources/ffmpeg/${process.platform}-${process.arch}/${executableName}.`
      ].join(' ')
    )
  }

  validateFfmpegBinary(candidate)
  cachedFfmpegPath = candidate
  return cachedFfmpegPath
}

function ffmpegCandidates() {
  const explicitPath = process.env.SURROUNDSTREAMER_FFMPEG_PATH
  const candidates = []

  if (explicitPath) {
    candidates.push(resolve(explicitPath))
  }

  candidates.push(
    join(
      process.resourcesPath || '',
      'app.asar.unpacked',
      'resources',
      'ffmpeg',
      platformKey(),
      executableName
    ),
    join(
      process.resourcesPath || '',
      'app.asar.unpacked',
      'resources',
      'ffmpeg',
      process.platform,
      executableName
    ),
    join(process.resourcesPath || '', 'resources', 'ffmpeg', platformKey(), executableName),
    join(process.resourcesPath || '', 'ffmpeg', platformKey(), executableName),
    resolve(process.cwd(), 'resources', 'ffmpeg', platformKey(), executableName),
    resolve(process.cwd(), 'resources', 'ffmpeg', process.platform, executableName)
  )

  if (!isPackagedRuntime()) {
    const pathCandidate = findOnPath(executableName)
    if (pathCandidate) candidates.push(pathCandidate)
  }

  return [...new Set(candidates.filter(Boolean))]
}

function platformKey() {
  return `${process.platform}-${process.arch}`
}

function isPackagedRuntime() {
  return Boolean(process.resourcesPath && !process.defaultApp && !process.env.ELECTRON_RENDERER_URL)
}

function findOnPath(name) {
  for (const pathEntry of String(process.env.PATH || '').split(delimiter)) {
    if (!pathEntry) continue
    const candidate = join(pathEntry, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

function isExecutableFile(path) {
  try {
    if (!path || !existsSync(path)) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function validateFfmpegBinary(path) {
  const result = spawnSync(path, ['-hide_banner', '-version'], {
    cwd: dirname(path),
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.error) {
    throw new Error(`Could not run FFmpeg at ${path}: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`Could not inspect FFmpeg at ${path}${detail ? `: ${detail}` : ''}`)
  }

  const versionOutput = `${result.stdout || ''}\n${result.stderr || ''}`
  const configureLine = versionOutput
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('configuration:'))

  if (configureLine?.includes('--enable-nonfree')) {
    throw new Error(
      `FFmpeg at ${path} was built with --enable-nonfree and must not be bundled with SurroundStreamer.`
    )
  }

  // GPL policy is enforced by the packaging check. Runtime validation only blocks nonfree builds
  // so an intentionally packaged GPL build can still launch without environment variables.
}
