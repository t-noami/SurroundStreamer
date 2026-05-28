import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'

const helperPath = resolve('native/audio-backends/macos/.build/SurroundAudioBackend')
const durationMs = Number(process.argv.find((arg) => arg.startsWith('--duration='))?.split('=')[1] || 1500)
const uidFilter = process.argv.find((arg) => arg.startsWith('--uid='))?.slice('--uid='.length)
const nameFilter = process.argv.find((arg) => arg.startsWith('--name='))?.slice('--name='.length)

if (!existsSync(helperPath)) {
  throw new Error(`CoreAudio helper not found: ${helperPath}`)
}

const devices = await listInputStreams()
const targets = devices
  .flatMap((device) =>
    (device.streams || []).map((stream) => ({
      name: device.name,
      uid: device.deviceUID,
      streamIndex: stream.streamIndex,
      channels: Number(stream.channels || 0),
      sampleRate: Number(stream.sampleRate || 48000),
      bitsPerChannel: Number(stream.bitsPerChannel || 0),
      formatFlags: Number(stream.formatFlags || 0)
    }))
  )
  .filter((stream) => stream.channels > 2)
  .filter((stream) => !uidFilter || stream.uid === uidFilter)
  .filter((stream) => !nameFilter || stream.name.toLowerCase().includes(nameFilter.toLowerCase()))

if (targets.length === 0) {
  throw new Error('No matching multichannel CoreAudio input streams found.')
}

for (const target of targets) {
  const analysis = await analyzeStream(target)
  console.log(JSON.stringify(analysis, null, 2))
}

function listInputStreams() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(helperPath, ['--list-input-streams'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`list-input-streams exited ${code}: ${Buffer.concat(stderr)}`))
        return
      }
      resolvePromise(JSON.parse(Buffer.concat(stdout).toString()).devices || [])
    })
  })
}

function analyzeStream(target) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      helperPath,
      [
        '--stream-input-device',
        '--device-uid',
        target.uid,
        '--stream-index',
        String(target.streamIndex)
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const chunks = []
    const stderr = []
    let format = null
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => {
      stderr.push(chunk)
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          if (parsed.event === 'format') format = parsed
        } catch {
          // ignore non-JSON helper diagnostics
        }
      }
    })
    child.on('error', rejectPromise)
    child.on('close', () => {
      const data = Buffer.concat(chunks)
      const channels = Number(format?.channels || target.channels)
      const sampleRate = Number(format?.sampleRate || target.sampleRate)
      resolvePromise({
        name: target.name,
        uid: target.uid,
        streamIndex: target.streamIndex,
        expectedChannels: target.channels,
        reportedFormat: format,
        capturedBytes: data.byteLength,
        capturedFrames: Math.floor(data.byteLength / Math.max(1, channels * 4)),
        analysis: analyzeFloat32(data, channels),
        stderr: Buffer.concat(stderr).toString().trim().split(/\r?\n/).filter(Boolean).slice(0, 6),
        sampleRate
      })
    })
    setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 500).unref()
    }, durationMs).unref()
  })
}

function analyzeFloat32(buffer, channels) {
  const sampleCount = Math.floor(buffer.byteLength / 4)
  const frameCount = Math.floor(sampleCount / channels)
  const peaks = Array.from({ length: channels }, () => 0)
  const sums = Array.from({ length: channels }, () => 0)
  const nonFinite = Array.from({ length: channels }, () => 0)
  const firstNonZero = Array.from({ length: channels }, () => -1)
  const maxAbs = 100

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = buffer.readFloatLE((frame * channels + channel) * 4)
      if (!Number.isFinite(sample)) {
        nonFinite[channel] += 1
        continue
      }
      const abs = Math.abs(sample)
      if (abs > peaks[channel]) peaks[channel] = abs
      if (abs > 1e-7 && firstNonZero[channel] < 0) firstNonZero[channel] = frame
      if (abs > maxAbs) nonFinite[channel] += 1
      sums[channel] += sample * sample
    }
  }

  return peaks.map((peak, channel) => ({
    channel: channel + 1,
    peak,
    rms: frameCount > 0 ? Math.sqrt(sums[channel] / frameCount) : 0,
    nonFiniteOrHuge: nonFinite[channel],
    firstNonZeroFrame: firstNonZero[channel]
  }))
}
