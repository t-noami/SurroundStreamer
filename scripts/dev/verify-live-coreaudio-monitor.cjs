const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const { existsSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { pathToFileURL } = require('url')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const helperPath = resolve('native/audio-backends/macos/.build/SurroundAudioBackend')
const targetName = process.env.MONITOR_VERIFY_INPUT_NAME || 'Pro Tools Audio Bridge 16'
const durationMs = Number(process.env.MONITOR_VERIFY_CAPTURE_MS || 3000)

app.whenReady().then(async () => {
  let hadError = false
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false
    }
  })

  try {
    if (!existsSync(helperPath)) {
      throw new Error(`CoreAudio helper not found: ${helperPath}`)
    }

    const target = await findTargetStream(targetName)
    const capture = await captureStream(target)
    const inputAnalysis = analysePcm(capture.buffer, target.channels)
    if (capture.buffer.byteLength < target.channels * 4 * 1024) {
      throw new Error(`Captured too little PCM: ${capture.buffer.byteLength} bytes`)
    }

    const monitorAudioUrl = pathToFileURL(resolve('src/renderer/src/monitor-audio.js')).href
    const workletUrl = pathToFileURL(resolve('src/renderer/src/monitor-worklet.js')).href
    const htmlPath = join(tmpdir(), `surroundstreamer-live-monitor-verify-${process.pid}.html`)
    writeFileSync(
      htmlPath,
      `<!doctype html>
<meta charset="utf-8">
<script type="module">
import { WebAudioMonitor } from ${JSON.stringify(monitorAudioUrl)}

const labels = ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BL', 'BR']
const channels = ${target.channels}
const sampleRate = ${capture.sampleRate}
const pcmBase64 = ${JSON.stringify(capture.buffer.toString('base64'))}
const workletUrl = ${JSON.stringify(workletUrl)}

window.__runLiveMonitorVerification = async () => {
  const bytes = Uint8Array.from(atob(pcmBase64), (char) => char.charCodeAt(0))
  const results = []
  for (const scenario of [
    { mode: 'stereo-pair', pairStart: 2, name: 'C/LFE stereo pair' },
    { mode: 'stereo-pair', pairStart: 4, name: 'SL/SR stereo pair' },
    { mode: 'downmix', pairStart: 0, name: 'Stereo downmix', monitorChannelIndexes: [0, 1, 2, 3, 4, 5] },
    { mode: 'binaural', pairStart: 0, name: 'Binaural', monitorChannelIndexes: [0, 1, 2, 3, 4, 5] }
  ]) {
    results.push(await verifyScenario(bytes, scenario))
  }
  return results
}

async function verifyScenario(bytes, scenario) {
  const monitor = new WebAudioMonitor()
  await monitor.start({
    mode: scenario.mode,
    pairStart: scenario.pairStart,
    channels,
    channelLabels: Array.from({ length: channels }, (_value, index) => labels[index] || (index % 2 ? 'FR' : 'FL')),
    sampleRate,
    latencyMs: 40,
    lowLatency: true,
    volume: 1,
    monitorChannelIndexes: scenario.monitorChannelIndexes,
    workletUrl
  })

  const splitter = monitor.context.createChannelSplitter(2)
  const left = monitor.context.createAnalyser()
  const right = monitor.context.createAnalyser()
  left.fftSize = 4096
  right.fftSize = 4096
  monitor.outputGain.connect(splitter)
  splitter.connect(left, 0, 0)
  splitter.connect(right, 1, 0)
  await monitor.context.resume()

  const frameBytes = channels * 4
  const chunkBytes = frameBytes * 256 + 17
  let offset = 0
  const timer = setInterval(() => {
    if (offset >= bytes.byteLength) {
      offset = 0
    }
    const next = Math.min(bytes.byteLength, offset + chunkBytes)
    monitor.pushChunk(bytes.slice(offset, next))
    offset = next
  }, 3)

  await delay(900)
  clearInterval(timer)
  await delay(120)
  const metrics = {
    scenario: scenario.name,
    left: analyse(left),
    right: analyse(right)
  }
  await monitor.stop()
  assertMetrics(metrics)
  return metrics
}

function analyse(analyser) {
  const samples = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(samples)
  let peak = 0
  let sumSquares = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return { peak: Number.NaN, rms: Number.NaN }
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
    sumSquares += sample * sample
  }
  return { peak, rms: Math.sqrt(sumSquares / samples.length) }
}

function assertMetrics(metrics) {
  const peak = Math.max(metrics.left.peak, metrics.right.peak)
  const rms = Math.max(metrics.left.rms, metrics.right.rms)
  if (!Number.isFinite(peak) || !Number.isFinite(rms)) {
    throw new Error(metrics.scenario + ': non-finite output')
  }
  if (peak > 1.05) {
    throw new Error(metrics.scenario + ': clipping/noise peak ' + peak)
  }
  if (peak < 0.001 || rms < 0.0001) {
    throw new Error(metrics.scenario + ': silent output')
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
</script>`
    )

    await window.loadFile(htmlPath)
    const results = await window.webContents.executeJavaScript(
      'window.__runLiveMonitorVerification()'
    )
    console.log(
      JSON.stringify(
        { ok: true, target, capturedBytes: capture.buffer.byteLength, inputAnalysis, results },
        null,
        2
      )
    )
  } catch (error) {
    hadError = true
    console.error(error?.stack || error?.message || String(error))
    process.exitCode = 1
  } finally {
    window.destroy()
    if (hadError) {
      app.exit(1)
    } else {
      app.quit()
    }
  }
})

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
