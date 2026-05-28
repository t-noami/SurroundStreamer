const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { pathToFileURL } = require('url')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const labels = ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BL', 'BR']
const sampleRate = 48000

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false
    }
  })

  try {
    const monitorAudioUrl = pathToFileURL(resolve('src/renderer/src/monitor-audio.js')).href
    const workletPath = resolve(
      process.env.MONITOR_VERIFY_WORKLET_PATH || 'src/renderer/public/monitor-worklet.js'
    )
    const workletUrl = pathToFileURL(workletPath).href
    const htmlPath = join(tmpdir(), `surroundstreamer-monitor-verify-${process.pid}.html`)
    writeFileSync(
      htmlPath,
      `<!doctype html>
<meta charset="utf-8">
<script type="module">
import { WebAudioMonitor } from ${JSON.stringify(monitorAudioUrl)}

const labels = ${JSON.stringify(labels)}
const sampleRate = ${sampleRate}
const workletUrl = ${JSON.stringify(workletUrl)}

window.__runMonitorVerification = async () => {
  const results = []
  for (const mode of ['downmix', 'binaural']) {
    for (let channel = 0; channel < labels.length; channel += 1) {
      results.push(await verifyModeChannel(mode, channel))
    }
  }
  return results
}

async function verifyModeChannel(mode, activeChannel) {
  const monitor = new WebAudioMonitor()
  await monitor.start({
    mode,
    channels: labels.length,
    channelLabels: labels,
    sampleRate,
    latencyMs: 20,
    lowLatency: true,
    volume: 1,
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
  const interval = feedChannel(monitor, activeChannel)
  await delay(850)
  clearInterval(interval)
  await delay(120)

  const metrics = {
    mode,
    channel: activeChannel + 1,
    label: labels[activeChannel],
    left: analyse(left),
    right: analyse(right)
  }
  await monitor.stop()
  assertMetrics(metrics)
  return metrics
}

function feedChannel(monitor, activeChannel) {
  let phase = 0
  let fragmentIndex = 0
  const fragments = [3, 17, 64, 509, 11, 2048, 5]
  const frequency = labels[activeChannel] === 'LFE' ? 80 : 220 + activeChannel * 17
  const phaseStep = (Math.PI * 2 * frequency) / sampleRate
  return setInterval(() => {
    const frames = 128
    const data = new Float32Array(frames * labels.length)
    for (let frame = 0; frame < frames; frame += 1) {
      data[frame * labels.length + activeChannel] = Math.sin(phase) * 0.2
      phase += phaseStep
      if (phase > Math.PI * 2) phase -= Math.PI * 2
    }
    const bytes = new Uint8Array(data.buffer)
    let offset = 0
    while (offset < bytes.byteLength) {
      const size = fragments[fragmentIndex % fragments.length]
      monitor.pushChunk(bytes.slice(offset, Math.min(bytes.byteLength, offset + size)))
      offset += size
      fragmentIndex += 1
    }
  }, 2)
}

function analyse(analyser) {
  const samples = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(samples)
  let peak = 0
  let sumSquares = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample)) {
      return { peak: Number.NaN, rms: Number.NaN }
    }
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
    sumSquares += sample * sample
  }
  return { peak, rms: Math.sqrt(sumSquares / samples.length) }
}

function assertMetrics(metrics) {
  for (const side of ['left', 'right']) {
    const value = metrics[side]
    if (!Number.isFinite(value.peak) || !Number.isFinite(value.rms)) {
      throw new Error(formatFailure(metrics, side, 'non-finite output'))
    }
    if (value.peak > 1.05) {
      throw new Error(formatFailure(metrics, side, 'clipping/noise peak ' + value.peak))
    }
  }

  const peak = Math.max(metrics.left.peak, metrics.right.peak)
  const rms = Math.max(metrics.left.rms, metrics.right.rms)
  if (peak < 0.001 || rms < 0.0001) {
    throw new Error(formatFailure(metrics, 'stereo', 'silent output'))
  }
}

function formatFailure(metrics, side, reason) {
  return metrics.mode + ' ch' + metrics.channel + ' (' + metrics.label + ') ' + side + ': ' + reason
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
</script>`
    )

    await window.loadFile(htmlPath)
    const results = await window.webContents.executeJavaScript('window.__runMonitorVerification()')
    console.log(JSON.stringify({ ok: true, workletPath, results }, null, 2))
  } catch (error) {
    console.error(error?.stack || error?.message || String(error))
    process.exitCode = 1
  } finally {
    window.destroy()
    app.quit()
  }
})
