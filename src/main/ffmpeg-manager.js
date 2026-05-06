import ffmpeg from 'fluent-ffmpeg'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { getFfmpegPath } from './ffmpeg-path'
import appAudioHelper from './app-audio-helper'

const ffmpegPath = getFfmpegPath()
ffmpeg.setFfmpegPath(ffmpegPath)

class FFmpegManager extends EventEmitter {
  constructor() {
    super()
    this.process = null
    this.appAudioProcess = null
    this.status = 'idle' // 'idle' | 'streaming' | 'error'
    this.config = null
    this.ffmpegStderrBuffer = ''
    this.pendingPeaks = {}
    this.monitorFormat = null
    this.monitorForwarding = false
  }

  async startStream(config) {
    if (this.process) {
      throw new Error('Stream is already running')
    }

    this.config = config
    this.status = 'streaming'
    this.ffmpegStderrBuffer = ''
    this.pendingPeaks = {}
    this.monitorFormat = this.getMonitorFormat(config)
    this.monitorForwarding = !!config.monitorEnabled

    const args = this.buildArgs(config)

    this.emit('log', {
      type: 'system',
      message: `Starting FFmpeg: ${this.redactArgs(args).join(' ')}`
    })

    const stdio = this.monitorFormat ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe']
    this.process = spawn(ffmpegPath, args, { stdio })
    this.attachFfmpegEvents()

    try {
      if (config.inputType === 'app-audio') {
        this.startAppAudioPipe(config)
      }

      await this.waitForStartup()
      this.emit('status', this.getStatus())
    } catch (error) {
      this.cleanupAppAudioProcess()
      if (this.process && !this.process.killed) {
        this.process.kill('SIGTERM')
      }
      this.process = null
      this.status = 'idle'
      this.monitorFormat = null
      this.monitorForwarding = false
      this.emit('monitor-stop')
      throw error
    }
  }

  attachFfmpegEvents() {
    this.process.stdout.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        this.emit('log', { type: 'ffmpeg', message })
      }
    })

    this.process.stderr.on('data', (data) => {
      this.handleFfmpegStderr(data.toString())
    })

    if (this.monitorFormat && this.process.stdio[3]) {
      this.emit('monitor-format', this.monitorFormat)
      this.process.stdio[3].on('data', (data) => {
        const chunk = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        if (this.monitorForwarding) {
          this.emit('monitor-audio', { chunk })
        }
      })
    }

    this.process.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        this.emit('log', { type: 'error', message: `FFmpeg stdin error: ${error.message}` })
      }
    })

    this.process.on('close', (code) => {
      if (this.ffmpegStderrBuffer.trim()) {
        this.emit('log', { type: 'ffmpeg', message: this.ffmpegStderrBuffer.trim() })
      }
      this.emit('log', {
        type: code === 0 ? 'system' : 'error',
        message: `FFmpeg exited with code ${code}`
      })
      this.cleanupAppAudioProcess()
      this.process = null
      this.status = 'idle'
      this.monitorForwarding = false
      this.emit('status', this.getStatus())
      this.emit('monitor-stop')
    })

    this.process.on('error', (err) => {
      this.emit('log', { type: 'error', message: `FFmpeg process error: ${err.message}` })
      this.status = 'error'
      this.emit('status', this.getStatus())
    })
  }

  handleFfmpegStderr(chunk) {
    this.ffmpegStderrBuffer += chunk
    const lines = this.ffmpegStderrBuffer.split(/\r?\n/)
    this.ffmpegStderrBuffer = lines.pop() || ''

    const visibleLines = []
    for (const line of lines) {
      if (!this.handleMeterLine(line)) {
        visibleLines.push(line)
      }
    }

    const message = visibleLines.join('\n').trim()
    if (message) {
      this.emit('log', { type: 'ffmpeg', message })
    }
  }

  handleMeterLine(line) {
    if (
      !line.includes('lavfi.astats') &&
      !line.includes('Parsed_ametadata') &&
      !line.includes('Parsed_astats')
    ) {
      return false
    }

    const match = line.match(/lavfi\.astats\.(\d+)\.Peak_level=([^\s]+)/)
    if (!match) {
      return true
    }

    const channelIndex = Number(match[1]) - 1
    const db = match[2] === '-inf' ? -120 : Number(match[2])
    if (!Number.isFinite(db)) {
      return true
    }

    this.pendingPeaks[channelIndex] = db
    this.emit('meter', {
      channels: this.getOutputChannels(this.config),
      peaks: this.pendingPeaks
    })
    return true
  }

  startAppAudioPipe(config) {
    const pid = Number(config.appAudioPid || config.inputPath)
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error('App Audio input requires a valid process id')
    }

    const tapOptions = this.getAppAudioTapOptions(config)
    const modeLabel = tapOptions.deviceUID ? 'preserve surround' : 'stereo mixdown'
    this.emit('log', {
      type: 'system',
      message: `Starting app audio tap for PID ${pid} (${modeLabel})`
    })
    this.appAudioProcess = appAudioHelper.spawnPCMStream(pid, tapOptions)

    this.appAudioProcess.stdout.pipe(this.process.stdin)

    this.appAudioProcess.stderr.on('data', (data) => {
      const message = data.toString().trim()
      if (!message) return

      const parsed = this.tryParseJSON(message)
      if (parsed?.event === 'format') {
        this.emit('log', {
          type: 'system',
          message: `App audio tap format: ${parsed.channels}ch @ ${parsed.sampleRate}Hz, ${parsed.bitsPerChannel}-bit float`
        })
        return
      }

      if (parsed?.event === 'error') {
        this.emit('log', { type: 'error', message: `App audio tap error: ${parsed.message}` })
        return
      }

      this.emit('log', { type: 'system', message: `App audio tap: ${message}` })
    })

    this.appAudioProcess.on('error', (error) => {
      this.emit('log', { type: 'error', message: `App audio tap process error: ${error.message}` })
    })

    this.appAudioProcess.on('close', (code) => {
      if (this.process) {
        this.process.stdin.end()
      }
      this.emit('log', {
        type: code === 0 ? 'system' : 'error',
        message: `App audio tap exited with code ${code}`
      })
      this.appAudioProcess = null
    })
  }

  waitForStartup() {
    return new Promise((resolve, reject) => {
      const startupTimer = setTimeout(resolve, 1500)

      this.process.once('error', (error) => {
        clearTimeout(startupTimer)
        reject(error)
      })

      this.process.once('close', (code) => {
        clearTimeout(startupTimer)
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`FFmpeg exited during startup with code ${code}`))
        }
      })
    })
  }

  async stopStream() {
    if (!this.process) {
      return
    }

    return new Promise((resolve) => {
      this.process.on('close', () => {
        resolve()
      })
      this.cleanupAppAudioProcess()
      this.process.kill('SIGTERM')
      this.monitorForwarding = false
      this.emit('monitor-stop')
    })
  }

  setMonitorActive(isActive) {
    this.monitorForwarding = !!isActive
  }

  cleanupAppAudioProcess() {
    if (!this.appAudioProcess) {
      return
    }

    const processToStop = this.appAudioProcess
    this.appAudioProcess = null
    if (!processToStop.killed) {
      processToStop.kill('SIGTERM')
    }
  }

  getStatus() {
    return {
      status: this.status,
      isRunning: !!this.process
    }
  }

  buildArgs(config) {
    const {
      inputType,
      inputPath,
      loopFile = true,
      bitrate = '384k',
      icecastHost,
      icecastPort,
      mountPoint,
      sourcePassword
    } = config

    const args = []
    const outputChannels = this.getOutputChannels(config)
    const outputSampleRate = this.getOutputSampleRate(config)
    const outputLayout = this.channelLayoutFor(outputChannels)
    const monitorEnabled = true

    if (inputType === 'file') {
      if (loopFile) {
        args.push('-stream_loop', '-1')
      }
      args.push('-re')
      args.push('-i', inputPath)
    } else if (inputType === 'device') {
      args.push('-f', 'avfoundation')
      args.push('-i', inputPath)
    } else if (inputType === 'app-audio') {
      const appAudioChannels = this.getAppAudioChannels(config)
      const appAudioSampleRate = this.getAppAudioSampleRate(config)
      const appAudioLayout = this.channelLayoutFor(appAudioChannels)
      args.push('-f', 'f32le')
      args.push('-ar', String(appAudioSampleRate))
      args.push('-ac', String(appAudioChannels))
      if (appAudioLayout) {
        args.push('-channel_layout', appAudioLayout)
      }
      args.push('-i', 'pipe:0')
    }

    args.push('-vn')

    if (monitorEnabled) {
      args.push('-filter_complex', this.buildMonitorFilterGraph(config, outputChannels))
      args.push('-map', '[enc]')
    } else {
      const audioFilter = this.buildAudioFilter(config, outputChannels)
      if (audioFilter) {
        args.push('-af', audioFilter)
      }
    }

    args.push('-ar', String(outputSampleRate))
    args.push('-ac', String(outputChannels))
    if (outputLayout) {
      args.push('-channel_layout', outputLayout)
    }
    args.push('-c:a', 'libopus')
    args.push('-b:a', bitrate)
    args.push('-vbr', 'on')
    args.push('-application', 'audio')
    if (outputChannels > 2 && outputChannels <= 8) {
      args.push('-mapping_family', '1')
    } else if (outputChannels > 8) {
      args.push('-mapping_family', '255')
    }
    args.push('-frame_duration', '20')
    args.push('-f', 'ogg')
    args.push('-content_type', 'audio/ogg')

    const icecastUrl = `icecast://source:${sourcePassword}@${icecastHost}:${icecastPort}${mountPoint}`
    args.push(icecastUrl)

    if (monitorEnabled) {
      const monitorChannels = this.getMonitorChannels(config, outputChannels)
      args.push('-map', '[mon]')
      args.push('-ar', String(outputSampleRate))
      args.push('-ac', String(monitorChannels))
      args.push('-c:a', 'pcm_f32le')
      args.push('-f', 'f32le')
      args.push('pipe:3')
    }

    return args
  }

  buildAudioFilter(config, outputChannels) {
    const filters = this.buildPreEncodeFilters(config, outputChannels)
    filters.push(...this.buildMeterFilters(outputChannels))
    return filters.join(',')
  }

  buildMonitorFilterGraph(config, outputChannels) {
    const filters = this.buildPreEncodeFilters(config, outputChannels)
    const prefix = filters.length > 0 ? `${filters.join(',')},` : ''
    const monitorFilter = this.buildMonitorFilter(config, outputChannels)
    return `[0:a]${prefix}asplit=2[encbase][monbase];[encbase]${this.buildMeterFilters(outputChannels).join(',')}[enc];[monbase]${monitorFilter}[mon]`
  }

  buildPreEncodeFilters(config, outputChannels) {
    const filters = []
    const channelSelection = this.getChannelSelection(config, outputChannels)
    const needsPan = channelSelection.some(
      (sourceIndex, outputIndex) => sourceIndex !== outputIndex
    )

    if (needsPan) {
      const layout = this.channelLayoutFor(outputChannels) || `${outputChannels}c`
      const mappings = channelSelection
        .map((sourceIndex, outputIndex) => `c${outputIndex}=c${sourceIndex}`)
        .join('|')
      filters.push(`pan=${layout}|${mappings}`)
    }

    return filters
  }

  buildMeterFilters(outputChannels) {
    const filters = ['astats=metadata=1:reset=1']
    for (let channel = 1; channel <= Math.min(outputChannels, 16); channel += 1) {
      filters.push(`ametadata=print:key=lavfi.astats.${channel}.Peak_level`)
    }
    return filters
  }

  buildMonitorFilter() {
    return 'anull'
  }

  getMonitorChannels(_config, outputChannels = this.getOutputChannels(_config)) {
    return outputChannels
  }

  getMonitorFormat(config) {
    const outputChannels = this.getOutputChannels(config)
    return {
      mode: config.monitorMode || 'stereo',
      sampleRate: this.getOutputSampleRate(config),
      channels: this.getMonitorChannels(config, outputChannels)
    }
  }

  getAppAudioTapOptions(config) {
    if (config.appAudioMode !== 'preserve') {
      return {}
    }

    if (!config.appAudioDeviceUID || config.appAudioStreamIndex === undefined) {
      throw new Error('Preserve Surround requires an output device stream')
    }

    return {
      deviceUID: config.appAudioDeviceUID,
      streamIndex: Number(config.appAudioStreamIndex)
    }
  }

  getAppAudioChannels(config) {
    const channels = Number(config.appAudioChannels)
    if (Number.isInteger(channels) && channels > 0) {
      return channels
    }
    return 2
  }

  getAppAudioSampleRate(config) {
    const sampleRate = Number(config.appAudioSampleRate)
    if (Number.isFinite(sampleRate) && sampleRate > 0) {
      return Math.round(sampleRate)
    }
    return 48000
  }

  getOutputChannels(config) {
    const selected = this.getChannelSelection(config)
    if (selected.length > 0) {
      return selected.length
    }

    if (config?.inputType === 'app-audio') {
      return this.getAppAudioChannels(config)
    }

    return 6
  }

  getChannelSelection(config, fallbackChannels = null) {
    const selected = Array.isArray(config?.selectedChannels) ? config.selectedChannels : []
    const normalized = selected
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0)

    if (normalized.length > 0) {
      return [...new Set(normalized)]
    }

    const channels =
      fallbackChannels || (config?.inputType === 'app-audio' ? this.getAppAudioChannels(config) : 6)
    return Array.from({ length: channels }, (_value, index) => index)
  }

  getOutputSampleRate(config) {
    const sampleRate = Number(config?.sampleRate)
    if (Number.isFinite(sampleRate) && sampleRate > 0) {
      return Math.round(sampleRate)
    }

    if (config?.inputType === 'app-audio') {
      return this.getAppAudioSampleRate(config)
    }

    return 48000
  }

  channelLayoutFor(channels) {
    const layouts = {
      1: 'mono',
      2: 'stereo',
      3: '2.1',
      4: 'quad',
      5: '5.0',
      6: '5.1',
      7: '6.1',
      8: '7.1'
    }
    return layouts[channels] || null
  }

  redactArgs(args) {
    return args.map((arg) => arg.replace(/(icecast:\/\/source:)[^@]+@/, '$1******@'))
  }

  tryParseJSON(value) {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
}

export default new FFmpegManager()
