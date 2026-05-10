import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { getFfmpegPath } from '../ffmpeg-path'

const DEFAULT_SAMPLE_RATE = 48000
const DEFAULT_CHANNELS = 2

class WindowsDshowCaptureProcess extends EventEmitter {
  constructor(child, format) {
    super()
    this.child = child
    this.stdout = child.stdout
    this.stderr = new PassThrough()
    this.format = format

    child.stderr.on('data', (data) => {
      this.stderr.write(data)
    })
    child.on('error', (error) => this.emit('error', error))
    child.on('close', (code, signal) => {
      this.stderr.end()
      this.emit('close', code, signal)
    })

    process.nextTick(() => {
      this.stderr.write(
        `${JSON.stringify({
          event: 'format',
          sampleRate: format.sampleRate,
          channels: format.channels,
          layout: format.channels === 1 ? 'mono' : 'stereo',
          bitsPerChannel: 32
        })}\n`
      )
    })
  }

  get killed() {
    return this.child.killed
  }

  get exitCode() {
    return this.child.exitCode
  }

  get signalCode() {
    return this.child.signalCode
  }

  kill(signal = 'SIGTERM') {
    return this.child.kill(signal)
  }
}

class WindowsDshowBackend {
  getCapabilities() {
    return {
      platform: 'win32',
      backendName: 'windows-dshow-input',
      appAudioCapture: false,
      appAudioPerProcess: false,
      appAudioSurroundPreserve: false,
      inputDeviceCapture: true,
      inputDeviceMonitor: true,
      nativeInputDeviceMonitor: false,
      fileSource: true,
      monitorPlayback: true,
      monitorDeviceEnumeration: false,
      outputLoopbackCapture: true
    }
  }

  async listInputDevices() {
    const result = await this.runFfmpeg([
      '-hide_banner',
      '-f',
      'dshow',
      '-list_devices',
      'true',
      '-i',
      'dummy'
    ])
    const devices = this.parseDshowDevices(result.stderr)

    return await Promise.all(
      devices.map(async (device, index) => {
        const format = await this.bestDeviceFormat(device.id)
        return {
          index: String(index),
          name: device.name,
          deviceUID: this.encodeDeviceUID({
            id: device.id,
            name: device.name,
            sampleRate: format.sampleRate,
            channels: format.channels
          }),
          sampleRate: format.sampleRate,
          channels: format.channels,
          bitsPerChannel: format.bitsPerChannel,
          isLikelyLoopback: this.isLikelyLoopbackName(device.name)
        }
      })
    )
  }

  async listAppProcesses() {
    const loopbackDevices = await this.listLoopbackDevices()
    return {
      processes:
        loopbackDevices.length > 0
          ? [
              {
                pid: 1,
                name: 'System Output Loopback (DirectShow)',
                isRunningOutput: true,
                isPerProcess: false
              }
            ]
          : []
    }
  }

  async listAppOutputStreams() {
    const devices = await this.listLoopbackDevices()
    return {
      devices: devices.map((device) => ({
        name: device.name,
        deviceUID: device.deviceUID,
        streams: [
          {
            streamIndex: 0,
            sampleRate: device.sampleRate,
            channels: device.channels,
            bitsPerChannel: device.bitsPerChannel
          }
        ]
      }))
    }
  }

  async listInputStreams() {
    const devices = await this.listInputDevices()
    return {
      devices: devices.map((device) => ({
        name: device.name,
        deviceUID: device.deviceUID,
        streams: [
          {
            streamIndex: 0,
            sampleRate: device.sampleRate,
            channels: device.channels,
            bitsPerChannel: device.bitsPerChannel
          }
        ]
      }))
    }
  }

  spawnAppAudioPCMStream(_pid, options = {}) {
    const descriptor = this.decodeDeviceUID(options.deviceUID)
    if (!descriptor?.id) {
      throw new Error('Windows loopback capture requires a DirectShow loopback device id')
    }

    return this.spawnDshowPCMStream(descriptor)
  }

  spawnInputDevicePCMStream(options = {}) {
    const descriptor = this.decodeDeviceUID(options.deviceUID)
    if (!descriptor?.id) {
      throw new Error('Audio Input capture requires a DirectShow device id')
    }

    return this.spawnDshowPCMStream(descriptor)
  }

  spawnDshowPCMStream(descriptor) {
    const sampleRate = Number(descriptor.sampleRate) || DEFAULT_SAMPLE_RATE
    const channels = Number(descriptor.channels) || DEFAULT_CHANNELS
    const child = spawn(
      getFfmpegPath(),
      [
        '-hide_banner',
        '-loglevel',
        'warning',
        '-f',
        'dshow',
        '-audio_buffer_size',
        '50',
        '-i',
        `audio=${descriptor.id}`,
        '-vn',
        '-ar',
        String(sampleRate),
        '-ac',
        String(channels),
        '-c:a',
        'pcm_f32le',
        '-f',
        'f32le',
        'pipe:1'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    return new WindowsDshowCaptureProcess(child, {
      sampleRate,
      channels
    })
  }

  parseDshowDevices(output) {
    const devices = []
    let current = null

    for (const line of String(output || '').split(/\r?\n/)) {
      const deviceMatch = line.match(/"(.+)" \((audio|video|none)\)/)
      if (deviceMatch) {
        current = {
          name: deviceMatch[1],
          type: deviceMatch[2]
        }
        if (current.type === 'audio') {
          devices.push(current)
        }
        continue
      }

      const alternativeMatch = line.match(/Alternative name "(.+)"/)
      if (alternativeMatch && current?.type === 'audio') {
        current.id = alternativeMatch[1]
      }
    }

    return devices
      .filter((device) => device.id || device.name)
      .map((device) => ({
        ...device,
        id: device.id || device.name
      }))
  }

  async listLoopbackDevices() {
    const devices = await this.listInputDevices()
    return devices.filter((device) => device.isLikelyLoopback)
  }

  async bestDeviceFormat(deviceId) {
    try {
      const result = await this.runFfmpeg([
        '-hide_banner',
        '-f',
        'dshow',
        '-list_options',
        'true',
        '-i',
        `audio=${deviceId}`
      ])
      return this.pickBestFormat(this.parseDshowFormats(result.stderr))
    } catch {
      return {
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS,
        bitsPerChannel: 16
      }
    }
  }

  parseDshowFormats(output) {
    const formats = []
    for (const line of String(output || '').split(/\r?\n/)) {
      const match = line.match(/ch=\s*(\d+),\s*bits=\s*(\d+),\s*rate=\s*(\d+)/)
      if (!match) continue
      formats.push({
        channels: Number(match[1]),
        bitsPerChannel: Number(match[2]),
        sampleRate: Number(match[3])
      })
    }
    return formats
  }

  pickBestFormat(formats) {
    const validFormats = formats.filter(
      (format) =>
        Number.isInteger(format.channels) &&
        format.channels > 0 &&
        Number.isInteger(format.sampleRate) &&
        format.sampleRate > 0
    )

    if (validFormats.length === 0) {
      return {
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS,
        bitsPerChannel: 16
      }
    }

    const preferred = validFormats.find(
      (format) => format.channels === DEFAULT_CHANNELS && format.sampleRate === DEFAULT_SAMPLE_RATE
    )
    if (preferred) return preferred

    return [...validFormats].sort((left, right) => {
      const channelDiff = Number(right.channels) - Number(left.channels)
      if (channelDiff !== 0) return channelDiff
      const rateDiff = Number(right.sampleRate) - Number(left.sampleRate)
      if (rateDiff !== 0) return rateDiff
      return Number(right.bitsPerChannel || 0) - Number(left.bitsPerChannel || 0)
    })[0]
  }

  encodeDeviceUID(device) {
    return JSON.stringify({
      backend: 'dshow',
      id: device.id,
      name: device.name,
      sampleRate: device.sampleRate,
      channels: device.channels
    })
  }

  decodeDeviceUID(value) {
    try {
      const parsed = JSON.parse(value)
      return parsed?.backend === 'dshow' ? parsed : null
    } catch {
      return {
        backend: 'dshow',
        id: value,
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS
      }
    }
  }

  isLikelyLoopbackName(name = '') {
    return /\b(loopback|stereo mix|what u hear|virtual|vb-cable|cable|obs|steam streaming)\b/i.test(
      String(name)
    )
  }

  runFfmpeg(args) {
    return new Promise((resolve) => {
      const child = spawn(getFfmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })
      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      child.on('error', (error) => {
        resolve({ stdout, stderr: stderr || error.message, code: 1 })
      })
      child.on('close', (code) => {
        resolve({ stdout, stderr, code })
      })
    })
  }
}

export default new WindowsDshowBackend()
