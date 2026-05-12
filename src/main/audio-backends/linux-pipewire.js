import { spawn } from 'child_process'
import { accessSync, constants } from 'fs'
import { delimiter, join } from 'path'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { getFfmpegPath } from '../ffmpeg-path'

const DEFAULT_SAMPLE_RATE = 48000
const DEFAULT_CHANNELS = 2

class LinuxFfmpegCaptureProcess extends EventEmitter {
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
          layout: format.channels === 1 ? 'mono' : 'default',
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

class LinuxPipeWireBackend {
  getCapabilities() {
    const runtime = this.detectRuntime()
    return {
      platform: 'linux',
      backendName: runtime.backendName,
      appAudioCapture: false,
      appAudioPerProcess: false,
      appAudioSurroundPreserve: false,
      inputDeviceCapture: runtime.inputDeviceCapture,
      inputDeviceMonitor: runtime.inputDeviceCapture,
      nativeInputDeviceMonitor: false,
      fileSource: true,
      monitorPlayback: true,
      monitorDeviceEnumeration: false,
      outputLoopbackCapture: false
    }
  }

  async listInputDevices() {
    if (!this.isFfmpegAvailable()) return []

    if (this.hasExecutable('pactl')) {
      const pulseDevices = await this.listPulseSources()
      if (pulseDevices.length > 0) return pulseDevices
    }

    if (this.hasExecutable('arecord')) {
      return await this.listAlsaDevices()
    }

    return []
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
            bitsPerChannel: 32
          }
        ]
      }))
    }
  }

  async listAppProcesses() {
    return { processes: [] }
  }

  async listAppOutputStreams() {
    return { devices: [] }
  }

  spawnAppAudioPCMStream() {
    throw new Error('App Audio capture is not implemented on Linux')
  }

  spawnInputDevicePCMStream(options = {}) {
    const descriptor = this.decodeDeviceUID(options.deviceUID)
    if (!descriptor?.backend) {
      throw new Error('Linux audio input capture requires a PulseAudio/PipeWire or ALSA device id')
    }

    if (descriptor.backend === 'pulse') {
      return this.spawnPulsePCMStream(descriptor, options)
    }

    if (descriptor.backend === 'alsa') {
      return this.spawnAlsaPCMStream(descriptor, options)
    }

    throw new Error(`Unsupported Linux audio backend: ${descriptor.backend}`)
  }

  spawnNativeInputDeviceMonitor() {
    throw new Error('Native Audio Input monitor is not implemented on Linux')
  }

  spawnPulsePCMStream(descriptor, options = {}) {
    const sampleRate = this.normalizedSampleRate(options.sampleRate || descriptor.sampleRate)
    const channels = this.normalizedChannels(options.channels || descriptor.channels)
    const child = spawn(
      getFfmpegPath(),
      [
        '-hide_banner',
        '-loglevel',
        'warning',
        '-f',
        'pulse',
        '-sample_rate',
        String(sampleRate),
        '-channels',
        String(channels),
        '-i',
        descriptor.name,
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

    return new LinuxFfmpegCaptureProcess(child, { sampleRate, channels })
  }

  spawnAlsaPCMStream(descriptor, options = {}) {
    const sampleRate = this.normalizedSampleRate(options.sampleRate || descriptor.sampleRate)
    const channels = this.normalizedChannels(options.channels || descriptor.channels)
    const child = spawn(
      getFfmpegPath(),
      [
        '-hide_banner',
        '-loglevel',
        'warning',
        '-f',
        'alsa',
        '-sample_rate',
        String(sampleRate),
        '-channels',
        String(channels),
        '-i',
        descriptor.device,
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

    return new LinuxFfmpegCaptureProcess(child, { sampleRate, channels })
  }

  async listPulseSources() {
    const jsonResult = await this.runCommand('pactl', ['-f', 'json', 'list', 'sources'])
    const jsonDevices = this.parsePulseJsonSources(jsonResult.stdout)
    if (jsonDevices.length > 0) return jsonDevices

    const textResult = await this.runCommand('pactl', ['list', 'sources'])
    return this.parsePulseTextSources(textResult.stdout)
  }

  parsePulseJsonSources(output) {
    let sources = []
    try {
      const parsed = JSON.parse(output)
      sources = Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }

    return sources
      .map((source, index) => this.pulseSourceToDevice(source, index))
      .filter((device) => device)
  }

  parsePulseTextSources(output) {
    const sources = []
    let current = null

    for (const line of String(output || '').split(/\r?\n/)) {
      if (/^Source #\d+/.test(line)) {
        if (current) sources.push(current)
        current = {}
        continue
      }

      if (!current) continue

      const nameMatch = line.match(/^\s*Name:\s*(.+)$/)
      if (nameMatch) {
        current.name = nameMatch[1].trim()
        continue
      }

      const descriptionMatch = line.match(/^\s*Description:\s*(.+)$/)
      if (descriptionMatch) {
        current.description = descriptionMatch[1].trim()
        continue
      }

      const sampleSpecMatch = line.match(/^\s*Sample Specification:\s*(.+)$/)
      if (sampleSpecMatch) {
        current.sample_spec = sampleSpecMatch[1].trim()
        continue
      }

      const monitorMatch = line.match(/^\s*Monitor of Sink:\s*(.+)$/)
      if (monitorMatch) {
        current.monitor_of_sink = monitorMatch[1].trim()
      }
    }

    if (current) sources.push(current)

    return sources
      .map((source, index) => this.pulseSourceToDevice(source, index))
      .filter((device) => device)
  }

  pulseSourceToDevice(source, index) {
    const name = source.name || source.properties?.['device.name']
    if (!name) return null

    const format = this.parseSampleSpec(source.sample_spec)
    const description =
      source.description ||
      source.properties?.['device.description'] ||
      source.properties?.['node.description'] ||
      name
    const sampleRate = this.normalizedSampleRate(format.sampleRate)
    const channels = this.normalizedChannels(format.channels)
    return {
      index: String(index),
      name: description,
      deviceUID: this.encodeDeviceUID({
        backend: 'pulse',
        name,
        description,
        sampleRate,
        channels
      }),
      sampleRate,
      channels,
      bitsPerChannel: format.bitsPerChannel || 32,
      backend: 'pulse',
      isLikelyLoopback: this.isPulseMonitorSource(source)
    }
  }

  async listAlsaDevices() {
    const result = await this.runCommand('arecord', ['-l'])
    const devices = this.parseAlsaCards(result.stdout)

    if (devices.length > 0) return devices

    return [
      {
        index: '0',
        name: 'ALSA Default Input',
        deviceUID: this.encodeDeviceUID({
          backend: 'alsa',
          device: 'default',
          description: 'ALSA Default Input',
          sampleRate: DEFAULT_SAMPLE_RATE,
          channels: DEFAULT_CHANNELS
        }),
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS,
        bitsPerChannel: 32,
        backend: 'alsa'
      }
    ]
  }

  parseAlsaCards(output) {
    const devices = []
    for (const line of String(output || '').split(/\r?\n/)) {
      const match = line.match(
        /^card\s+(\d+):\s*(.+?)\[(.+?)\],\s*device\s+(\d+):\s*(.+?)\[(.+?)\]/
      )
      if (!match) continue

      const card = match[1]
      const cardName = match[3].trim()
      const device = match[4]
      const deviceName = match[6].trim()
      const alsaDevice = `hw:${card},${device}`
      const description = `${cardName} - ${deviceName}`
      devices.push({
        index: String(devices.length),
        name: description,
        deviceUID: this.encodeDeviceUID({
          backend: 'alsa',
          device: alsaDevice,
          description,
          sampleRate: DEFAULT_SAMPLE_RATE,
          channels: DEFAULT_CHANNELS
        }),
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS,
        bitsPerChannel: 32,
        backend: 'alsa'
      })
    }
    return devices
  }

  parseSampleSpec(sampleSpec) {
    if (sampleSpec && typeof sampleSpec === 'object') {
      return {
        sampleRate: Number(sampleSpec.rate) || DEFAULT_SAMPLE_RATE,
        channels: Number(sampleSpec.channels) || DEFAULT_CHANNELS,
        bitsPerChannel: this.bitsFromSampleFormat(sampleSpec.format)
      }
    }

    const text = String(sampleSpec || '')
    const match = text.match(/(\d+)ch\s+(\d+)Hz/i)
    return {
      sampleRate: match ? Number(match[2]) : DEFAULT_SAMPLE_RATE,
      channels: match ? Number(match[1]) : DEFAULT_CHANNELS,
      bitsPerChannel: this.bitsFromSampleFormat(text)
    }
  }

  bitsFromSampleFormat(format = '') {
    const text = String(format).toLowerCase()
    if (text.includes('64')) return 64
    if (text.includes('32')) return 32
    if (text.includes('24')) return 24
    if (text.includes('16')) return 16
    if (text.includes('8')) return 8
    return 32
  }

  isPulseMonitorSource(source) {
    const text = [
      source.name,
      source.description,
      source.monitor_of_sink,
      source.monitor_of_sink_name,
      source.properties?.['device.class'],
      source.properties?.['media.class']
    ]
      .filter(Boolean)
      .join(' ')
    return /\bmonitor\b/i.test(text)
  }

  encodeDeviceUID(device) {
    return JSON.stringify(device)
  }

  decodeDeviceUID(value) {
    try {
      const parsed = JSON.parse(value)
      return parsed?.backend ? parsed : null
    } catch {
      return null
    }
  }

  detectRuntime() {
    const ffmpegAvailable = this.isFfmpegAvailable()
    const pactlAvailable = this.hasExecutable('pactl')
    const alsaAvailable = this.hasExecutable('arecord')

    if (!ffmpegAvailable) {
      return {
        backendName: 'linux-audio-pending',
        inputDeviceCapture: false
      }
    }

    if (pactlAvailable) {
      return {
        backendName: 'linux-pipewire-pulse',
        inputDeviceCapture: true
      }
    }

    if (alsaAvailable) {
      return {
        backendName: 'linux-alsa',
        inputDeviceCapture: true
      }
    }

    return {
      backendName: 'linux-audio-pending',
      inputDeviceCapture: false
    }
  }

  isFfmpegAvailable() {
    try {
      getFfmpegPath()
      return true
    } catch {
      return false
    }
  }

  hasExecutable(name) {
    if (this.executableCache?.has(name)) return this.executableCache.get(name)
    if (!this.executableCache) this.executableCache = new Map()

    const found = Boolean(this.findOnPath(name))
    this.executableCache.set(name, found)
    return found
  }

  findOnPath(name) {
    for (const pathEntry of String(process.env.PATH || '').split(delimiter)) {
      if (!pathEntry) continue
      const candidate = join(pathEntry, name)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        // Keep scanning PATH.
      }
    }
    return null
  }

  runCommand(command, args) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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

  normalizedSampleRate(value) {
    const sampleRate = Number(value)
    return Number.isInteger(sampleRate) && sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE
  }

  normalizedChannels(value) {
    const channels = Number(value)
    return Number.isInteger(channels) && channels > 0 ? channels : DEFAULT_CHANNELS
  }
}

export default new LinuxPipeWireBackend()
