#!/usr/bin/env node

import { accessSync, constants, lstatSync, readdirSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const target = resolve(process.argv[2] || 'dist')
const files = walk(target)
const ffmpegStaticMatches = files.filter((file) => file.split(/[\\/]/).includes('ffmpeg-static'))

if (ffmpegStaticMatches.length > 0) {
  fail(`Packaged artifact contains ffmpeg-static:\n${ffmpegStaticMatches.join('\n')}`)
}

const ffmpegBinaries = files.filter((file) => {
  const name = basename(file)
  return (name === 'ffmpeg' || name === 'ffmpeg.exe') && isExecutableFile(file)
})

for (const ffmpegPath of ffmpegBinaries) {
  const result = spawnSync(process.execPath, ['scripts/check-ffmpeg-license.mjs', ffmpegPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status !== 0) {
    fail(result.stderr || result.stdout || `FFmpeg license check failed for ${ffmpegPath}`)
  }
}

console.log(
  `Package license check passed for ${target}. Checked ${ffmpegBinaries.length} FFmpeg ${ffmpegBinaries.length === 1 ? 'binary' : 'binaries'}.`
)

function walk(path) {
  const stats = lstatSync(path)
  if (stats.isSymbolicLink()) return []
  if (stats.isFile()) return [path]
  if (!stats.isDirectory()) return []

  const results = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    results.push(...walk(resolve(path, entry.name)))
  }
  return results
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

function fail(message) {
  console.error(message.trim())
  process.exit(1)
}
