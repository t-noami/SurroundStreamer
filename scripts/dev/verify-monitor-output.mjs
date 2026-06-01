import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { existsSync } from 'fs'
import { resolve } from 'path'
import vm from 'vm'

const labels = ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BL', 'BR']
const sampleRate = 48000
const channels = labels.length
const frames = 2048
const sourceValue = 0.2

verifyRendererRouting()
verifyRendererMonitorIndexSelection()
verifyBundledWorkletSource()
verifyStreamingMonitorRouting()
await verifyWebAudioGraph()
await verifyFfmpegDownmix()
console.log('monitor output verification passed: ch1-ch8 are finite and audible')

function verifyRendererRouting() {
  const monitorAudioPath = resolve('src/renderer/src/monitor-audio.js')
  const source = readFileSync(monitorAudioPath, 'utf8')
    .replace(/^import .*$/m, 'const KU100_NEAR_HRIR = { sampleRate: 48000, responses: {} }')
    .replace('export class WebAudioMonitor', 'class WebAudioMonitor')

  const context = {}
  vm.runInNewContext(
    `${source}\nglobalThis.__monitorTest = { SPEAKER_POSITIONS, downmixGains };`,
    context,
    { filename: monitorAudioPath }
  )

  for (let index = 0; index < labels.length; index += 1) {
    const gains = context.__monitorTest.downmixGains(index, labels.length, labels[index])
    assertFinite(gains.left, `renderer left gain ch${index + 1}`)
    assertFinite(gains.right, `renderer right gain ch${index + 1}`)
    if (Math.abs(gains.left) + Math.abs(gains.right) <= 0) {
      throw new Error(`renderer downmix mutes ch${index + 1} (${labels[index]})`)
    }
  }

  const lfe = context.__monitorTest.SPEAKER_POSITIONS.LFE
  if (!lfe || !(lfe.gain > 0)) {
    throw new Error('renderer binaural path mutes LFE/ch4')
  }
}

function verifyRendererMonitorIndexSelection() {
  const rendererPath = resolve('src/renderer/src/renderer.js')
  const source = readFileSync(rendererPath, 'utf8')
  const functionNames = ['monitorChannelIndexesForMonitorMode', 'monitorChannelIndexesForConfig']
  const snippets = functionNames.map((name) => extractFunction(source, name)).join('\n')
  const context = {}
  vm.runInNewContext(
    `${snippets}
globalThis.__monitorIndexTest = {
  monitorChannelIndexesForMonitorMode,
  monitorChannelIndexesForConfig
};`,
    context,
    { filename: rendererPath }
  )

  const deviceIndexes = context.__monitorIndexTest.monitorChannelIndexesForMonitorMode(
    { inputType: 'device', monitorMode: 'downmix', selectedChannels: [0, 1] },
    8
  )
  assertArrayEquals(deviceIndexes, [0, 1, 2, 3, 4, 5, 6, 7], 'device downmix indexes')

  const deviceBinauralIndexes = context.__monitorIndexTest.monitorChannelIndexesForMonitorMode(
    { inputType: 'device', monitorMode: 'binaural', selectedChannels: [0, 1] },
    8
  )
  assertArrayEquals(deviceBinauralIndexes, [0, 1, 2, 3, 4, 5, 6, 7], 'device binaural indexes')

  const fileIndexes = context.__monitorIndexTest.monitorChannelIndexesForMonitorMode(
    { inputType: 'file', monitorMode: 'downmix', selectedChannels: [0, 1] },
    8
  )
  assertArrayEquals(fileIndexes, [0, 1], 'file downmix indexes')
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`)
  if (start < 0) throw new Error(`Could not find ${name}`)
  const bodyStart = source.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`Could not extract ${name}`)
}

function verifyBundledWorkletSource() {
  const sourcePath = resolve('src/renderer/src/monitor-worklet.js')
  const publicPath = resolve('src/renderer/public/monitor-worklet.js')
  const source = readFileSync(sourcePath, 'utf8')
  const publicSource = readFileSync(publicPath, 'utf8')
  if (source !== publicSource) {
    throw new Error('renderer public monitor-worklet.js is out of sync with source worklet')
  }
  for (const token of ['outputMode', 'monitorChannelIndexes', 'mixStereoFrame']) {
    if (!publicSource.includes(token)) {
      throw new Error(`renderer public monitor-worklet.js is missing ${token}`)
    }
  }
}

function verifyStreamingMonitorRouting() {
  const managerPath = resolve('src/main/ffmpeg-manager.js')
  const source = readFileSync(managerPath, 'utf8')
  const requiredSnippets = [
    'this.monitorPipeEnabled || this.shouldUseInputPcmMonitor(config)',
    'forwardMonitor: this.shouldUseInputPcmMonitor(this.config)',
    'if (this.shouldUseInputPcmMonitor(config)) return false',
    'shouldUseInputPcmMonitor(config)'
  ]
  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      throw new Error(`streaming monitor routing is missing: ${snippet}`)
    }
  }
}

async function verifyFfmpegDownmix() {
  const ffmpegPath = resolve('resources/ffmpeg/darwin-arm64/ffmpeg')
  if (!existsSync(ffmpegPath)) {
    throw new Error(`FFmpeg not found: ${ffmpegPath}`)
  }

  for (let channel = 0; channel < channels; channel += 1) {
    const input = Buffer.alloc(frames * channels * 4)
    for (let frame = 0; frame < frames; frame += 1) {
      input.writeFloatLE(sourceValue, (frame * channels + channel) * 4)
    }

    const output = await runFfmpeg(ffmpegPath, downmixArgs(), input)
    const samples = new Float32Array(
      output.buffer,
      output.byteOffset,
      Math.floor(output.byteLength / 4)
    )
    let peak = 0
    for (const sample of samples) {
      assertFinite(sample, `ffmpeg sample ch${channel + 1}`)
      peak = Math.max(peak, Math.abs(sample))
    }
    if (peak <= 1e-5) {
      throw new Error(`ffmpeg downmix mutes ch${channel + 1} (${labels[channel]})`)
    }
    if (peak > 1) {
      throw new Error(`ffmpeg downmix clips/noises ch${channel + 1}: peak=${peak}`)
    }
  }
}

async function verifyWebAudioGraph() {
  const electronPath = resolve(
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron'
  )
  if (!existsSync(electronPath)) {
    throw new Error(`Electron binary not found: ${electronPath}`)
  }

  await runCommand(electronPath, [resolve('scripts/dev/verify-monitor-web-audio.cjs')])
  const builtWorkletPath = resolve('out/renderer/monitor-worklet.js')
  if (existsSync(builtWorkletPath)) {
    await runCommand(electronPath, [resolve('scripts/dev/verify-monitor-web-audio.cjs')], {
      MONITOR_VERIFY_WORKLET_PATH: builtWorkletPath
    })
  }
}

function downmixArgs() {
  const filter =
    'pan=stereo|' +
    'c0=c0+0.707*c2+0.707*c3+0.707*c4+0.707*c6|' +
    'c1=c1+0.707*c2+0.707*c3+0.707*c5+0.707*c7,' +
    'volume=0.707'
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'f32le',
    '-ar',
    String(sampleRate),
    '-ac',
    String(channels),
    '-i',
    'pipe:0',
    '-vn',
    '-filter_complex',
    `[0:a]${filter}[mon]`,
    '-map',
    '[mon]',
    '-ar',
    String(sampleRate),
    '-ac',
    '2',
    '-c:a',
    'pcm_f32le',
    '-f',
    'f32le',
    'pipe:1'
  ]
}

function runFfmpeg(ffmpegPath, args, input) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`FFmpeg exited ${code}: ${Buffer.concat(stderr).toString()}`))
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

function runCommand(command, args, env = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(
          new Error(
            `${command} exited ${code}: ${Buffer.concat(stderr).toString()}${Buffer.concat(stdout).toString()}`
          )
        )
        return
      }
      resolvePromise(Buffer.concat(stdout))
    })
  })
}

function assertFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} is not finite: ${value}`)
  }
}

function assertArrayEquals(actual, expected, label) {
  if (!Array.isArray(actual)) {
    throw new Error(`${label} is not an array: ${actual}`)
  }
  if (actual.length !== expected.length) {
    throw new Error(`${label} length mismatch: ${actual.length} !== ${expected.length}`)
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `${label} mismatch at ${index}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`
      )
    }
  }
}
