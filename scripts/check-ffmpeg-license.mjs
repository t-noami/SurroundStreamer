#!/usr/bin/env node

import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const target = resolve(process.argv[2] || defaultFfmpegPath())
const allowGpl = process.env.SURROUNDSTREAMER_ALLOW_GPL_FFMPEG === '1'

const targets = ffmpegTargets(target)
if (targets.length === 0) {
  fail(`FFmpeg binary is missing or not executable: ${target}`)
}

for (const ffmpegPath of targets) {
  checkFfmpeg(ffmpegPath)
}

console.log(
  `FFmpeg distribution check passed for ${targets.length} ${targets.length === 1 ? 'binary' : 'binaries'}.`
)

function checkFfmpeg(ffmpegPath) {
  const version = runFfmpeg(ffmpegPath, ['-hide_banner', '-version'])
  const configureLine = version
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('configuration:'))

  if (!configureLine) {
    fail(`Could not find FFmpeg configuration line in -version output for ${ffmpegPath}.`)
  }

  if (configureLine.includes('--enable-nonfree')) {
    fail(`FFmpeg was built with --enable-nonfree. Do not distribute this binary: ${ffmpegPath}`)
  }

  if (configureLine.includes('--enable-gpl') && !allowGpl) {
    fail(
      `FFmpeg was built with --enable-gpl. Use an LGPL-compatible build, or set SURROUNDSTREAMER_ALLOW_GPL_FFMPEG=1 for an intentional GPL distribution: ${ffmpegPath}`
    )
  }

  requireEntries(
    'encoder',
    ['libopus', 'libmp3lame', 'pcm_f32le'],
    runFfmpeg(ffmpegPath, ['-hide_banner', '-encoders']),
    ffmpegPath
  )
  requireEntries(
    'demuxer',
    ['aiff', 'caf', 'f32le', 'flac', 'ogg', 'wav'],
    runFfmpeg(ffmpegPath, ['-hide_banner', '-demuxers']),
    ffmpegPath
  )
  requireEntries(
    'decoder',
    ['aac', 'alac', 'flac', 'mp3', 'opus', 'vorbis'],
    runFfmpeg(ffmpegPath, ['-hide_banner', '-decoders']),
    ffmpegPath
  )
  requireEntries(
    'muxer',
    ['f32le', 'ogg', 'mp3'],
    runFfmpeg(ffmpegPath, ['-hide_banner', '-muxers']),
    ffmpegPath
  )
  requireEntries(
    'filter',
    [
      'ametadata',
      'anull',
      'anullsink',
      'aresample',
      'asetnsamples',
      'asplit',
      'astats',
      'headphone',
      'pan',
      'volume'
    ],
    runFfmpeg(ffmpegPath, ['-hide_banner', '-filters']),
    ffmpegPath
  )
  requireEntries(
    'protocol',
    ['file', 'icecast', 'pipe'],
    runFfmpeg(ffmpegPath, ['-hide_banner', '-protocols']),
    ffmpegPath
  )

  const requiredDevice =
    platformFor(ffmpegPath) === 'darwin'
      ? 'avfoundation'
      : platformFor(ffmpegPath) === 'win32'
        ? 'dshow'
        : null
  if (requiredDevice) {
    requireEntries(
      'device',
      [requiredDevice],
      runFfmpeg(ffmpegPath, ['-hide_banner', '-devices']),
      ffmpegPath
    )
  }
}

function defaultFfmpegPath() {
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return `resources/ffmpeg/${process.platform}-${process.arch}/${executable}`
}

function ffmpegTargets(path) {
  if (isExecutableFile(path)) return [path]

  let stats = null
  try {
    stats = statSync(path)
  } catch {
    return []
  }

  if (!stats.isDirectory()) return []

  const binaries = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      binaries.push(...ffmpegTargets(child))
    } else if (
      (entry.name === 'ffmpeg' || entry.name === 'ffmpeg.exe') &&
      isExecutableFile(child)
    ) {
      binaries.push(child)
    }
  }
  return binaries.sort()
}

function isExecutableFile(path) {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function platformFor(path) {
  if (path.includes('/darwin-') || path.includes('\\darwin-')) return 'darwin'
  if (path.includes('/win32-') || path.includes('\\win32-')) return 'win32'
  if (path.includes('/linux-') || path.includes('\\linux-')) return 'linux'
  return process.platform
}

function runFfmpeg(path, args) {
  const result = spawnSync(path, args, {
    cwd: dirname(path),
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.error) {
    fail(`Could not run FFmpeg: ${result.error.message}`)
  }
  if (result.status !== 0) {
    fail(`FFmpeg command failed: ${args.join(' ')}\n${result.stderr || result.stdout || ''}`)
  }

  return `${result.stdout || ''}\n${result.stderr || ''}`
}

function requireEntries(kind, names, output, path) {
  const missing = names.filter((name) => !hasEntry(output, name))
  if (missing.length > 0) {
    fail(
      `FFmpeg is missing required ${kind}${missing.length === 1 ? '' : 's'}: ${missing.join(', ')} (${path})`
    )
  }
}

function hasEntry(output, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'm').test(output)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
