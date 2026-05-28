const { spawn } = require('child_process')
const { existsSync } = require('fs')
const { resolve } = require('path')

const helperPath = resolve('native/audio-backends/macos/.build/SurroundAudioBackend')
const ffmpegPath = resolve('resources/ffmpeg/darwin-arm64/ffmpeg')
const hrirDir = resolve('resources/ku100-hrir')
const targetName = process.env.MONITOR_VERIFY_INPUT_NAME || 'Pro Tools Audio Bridge 16'
const durationMs = Number(process.env.MONITOR_VERIFY_CAPTURE_MS || 1400)
const labels = ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR']

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})

async function main() {
  if (!existsSync(helperPath)) throw new Error(`CoreAudio helper not found: ${helperPath}`)
  if (!existsSync(ffmpegPath)) throw new Error(`FFmpeg not found: ${ffmpegPath}`)

  const target = await findTargetStream(targetName)
  const capture = await captureStream(target)
  const downmix = await renderFiltered(capture.buffer, target, 'downmix')
  const binaural = await renderFiltered(capture.buffer, target, 'binaural')
  const result = {
    ok: true,
    target,
    capturedBytes: capture.buffer.byteLength,
    inputAnalysis: analysePcm(capture.buffer, target.channels).slice(0, 8),
    results: [
      { scenario: 'FFmpeg stereo downmix', ...analyseStereo(downmix) },
      { scenario: 'FFmpeg binaural', ...analyseStereo(binaural) }
    ]
  }
  for (const item of result.results) {
    assertStereoMetrics(item)
  }
  console.log(JSON.stringify(result, null, 2))
}

function renderFiltered(input, target, mode) {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'f32le',
      '-ar',
      String(target.sampleRate),
      '-ac',
      String(target.channels),
      '-i',
      'pipe:0'
    ]
    if (mode === 'binaural') {
      for (const label of labels) {
        args.push('-i', resolve(hrirDir, `${label}.wav`))
      }
    }
    args.push(
      '-vn',
      '-filter_complex',
      filterGraph(mode),
      '-map',
      '[mon]',
      '-ar',
      String(target.sampleRate),
      '-ac',
      '2',
      '-c:a',
      'pcm_f32le',
      '-f',
      'f32le',
      'pipe:1'
    )

    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`FFmpeg ${mode} exited ${code}: ${Buffer.concat(stderr)}`))
        return
      }
      resolvePromise(Buffer.concat(stdout))
    })

    const fragments = [3, 17, 64, 509, 11, 2048, 5]
    let offset = 0
    let fragment = 0
    while (offset < input.byteLength) {
      const size = fragments[fragment % fragments.length]
      child.stdin.write(input.subarray(offset, Math.min(input.byteLength, offset + size)))
      offset += size
      fragment += 1
    }
    child.stdin.end()
  })
}

function filterGraph(mode) {
  const select = 'pan=5.1|c0=c0|c1=c1|c2=c2|c3=c3|c4=c4|c5=c5'
  if (mode === 'downmix') {
    return `${select},pan=stereo|c0=c0+0.707*c2+0.707*c3+0.707*c4|c1=c1+0.707*c2+0.707*c3+0.707*c5,volume=0.707[mon]`
  }
  const inputs = labels.map((_label, index) => `[${index + 1}:a]`).join('')
  return `${select},pan=5.1|c0=1*c0|c1=1*c1|c2=0.707*c2|c3=0.707*c3|c4=0.707*c4|c5=0.707*c5[base];[base]${inputs}headphone=map=${labels.join('|')}:hrir=stereo:gain=8.881361[mon]`
}

function findTargetStream(name) {
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
      const devices = JSON.parse(Buffer.concat(stdout).toString()).devices || []
      const device = devices.find((item) =>
        String(item.name || '')
          .toLowerCase()
          .includes(name.toLowerCase())
      )
      const stream = (device?.streams || []).find((item) => Number(item.channels || 0) >= 8)
      if (!device || !stream) {
        rejectPromise(new Error(`No multichannel input matching "${name}"`))
        return
      }
      resolvePromise({
        name: device.name,
        uid: device.deviceUID,
        streamIndex: stream.streamIndex,
        channels: Number(stream.channels),
        sampleRate: Number(stream.sampleRate || 48000)
      })
    })
  })
}

function captureStream(target) {
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
    let sampleRate = target.sampleRate
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          if (parsed.event === 'format') sampleRate = Number(parsed.sampleRate || sampleRate)
        } catch {
          // ignore diagnostics
        }
      }
    })
    child.on('error', rejectPromise)
    child.on('close', () => resolvePromise({ buffer: Buffer.concat(chunks), sampleRate }))
    setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 500).unref()
    }, durationMs).unref()
  })
}

function analysePcm(buffer, channels) {
  const sampleCount = Math.floor(buffer.byteLength / 4)
  const frameCount = Math.floor(sampleCount / channels)
  const peaks = Array.from({ length: channels }, () => 0)
  const sums = Array.from({ length: channels }, () => 0)
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = buffer.readFloatLE((frame * channels + channel) * 4)
      if (!Number.isFinite(sample)) continue
      const abs = Math.abs(sample)
      if (abs > peaks[channel]) peaks[channel] = abs
      sums[channel] += sample * sample
    }
  }
  return peaks.map((peak, index) => ({
    channel: index + 1,
    peak,
    rms: frameCount ? Math.sqrt(sums[index] / frameCount) : 0
  }))
}

function analyseStereo(buffer) {
  return { left: analyseChannel(buffer, 0), right: analyseChannel(buffer, 1) }
}

function analyseChannel(buffer, channel) {
  const samples = Math.floor(buffer.byteLength / 4)
  const frames = Math.floor(samples / 2)
  let peak = 0
  let sum = 0
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = buffer.readFloatLE((frame * 2 + channel) * 4)
    if (!Number.isFinite(sample)) return { peak: Number.NaN, rms: Number.NaN }
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
    sum += sample * sample
  }
  return { peak, rms: frames ? Math.sqrt(sum / frames) : 0 }
}

function assertStereoMetrics(metrics) {
  const peak = Math.max(metrics.left.peak, metrics.right.peak)
  const rms = Math.max(metrics.left.rms, metrics.right.rms)
  if (!Number.isFinite(peak) || !Number.isFinite(rms)) {
    throw new Error(`${metrics.scenario}: non-finite output`)
  }
  if (peak > 1.05) {
    throw new Error(`${metrics.scenario}: clipping/noise peak ${peak}`)
  }
  if (peak < 0.001 || rms < 0.0001) {
    throw new Error(`${metrics.scenario}: silent output`)
  }
}
