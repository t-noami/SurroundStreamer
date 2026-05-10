import ffmpeg from 'fluent-ffmpeg'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { getFfmpegPath } from './ffmpeg-path'
import audioBackend from './audio-backends'

const ffmpegPath = getFfmpegPath()
ffmpeg.setFfmpegPath(ffmpegPath)

class FFmpegManager extends EventEmitter {
  constructor() {
    super()
    this.process = null
    this.inputDeviceProcess = null
    this.previewMonitorProcess = null
    this.previewMonitorKind = null
    this.status = 'idle' // 'idle' | 'streaming' | 'error'
    this.config = null
    this.ffmpegStderrBuffer = ''
    this.recentFfmpegLines = []
    this.pendingPeaks = {}
    this.monitorFormat = null
    this.monitorForwarding = false
    this.monitorPipeEnabled = false
    this.monitorAudioBuffers = []
    this.monitorAudioBytes = 0
    this.monitorAudioFlushTimer = null
  }

  validateBackendSupport(config) {
    const capabilities = audioBackend.getCapabilities()

    if (config.inputType === 'app-audio') {
      throw new Error('App Audio capture has been removed')
    }

    if (config.inputType === 'device' && !capabilities.inputDeviceCapture) {
      throw new Error(`Audio Input capture is not implemented on ${capabilities.platform}`)
    }

    if (config.inputType === 'file' && capabilities.fileSource === false) {
      throw new Error(`File source is not available on ${capabilities.platform}`)
    }
  }

  async startStream(config) {
    if (this.process) {
      throw new Error('Stream is already running')
    }
    this.validateBackendSupport(config)
    if (!(config.directInputMonitor && this.previewMonitorKind === 'native-input')) {
      this.stopPreviewMonitor()
    }

    this.config = config
    this.status = 'streaming'
    this.ffmpegStderrBuffer = ''
    this.recentFfmpegLines = []
    this.pendingPeaks = {}
    this.monitorFormat = this.getMonitorFormat(config)
    this.monitorPipeEnabled = this.shouldUseFfmpegMonitor(config)
    this.monitorForwarding = !!config.monitorEnabled && this.monitorPipeEnabled

    try {
      await this.prepareBackendCapture(config)
      this.monitorFormat = this.getMonitorFormat(config)
    } catch (error) {
      this.cleanupInputDeviceProcess()
      this.status = 'idle'
      this.monitorForwarding = false
      this.monitorPipeEnabled = false
      throw error
    }

    const args = this.buildArgs(config)

    this.emit('log', {
      type: 'system',
      message: `Starting FFmpeg: ${this.redactArgs(args).join(' ')}`
    })

    const stdio = this.monitorPipeEnabled
      ? ['pipe', 'pipe', 'pipe', 'pipe']
      : ['pipe', 'pipe', 'pipe']
    this.process = spawn(ffmpegPath, args, { stdio })
    this.attachFfmpegEvents()
    if (this.monitorFormat && !this.monitorPipeEnabled) {
      this.emit('monitor-format', this.monitorFormat)
    }

    try {
      this.attachBackendInputPipe(config)

      await this.waitForStartup()
      this.emit('status', this.getStatus())
    } catch (error) {
      this.cleanupInputDeviceProcess()
      if (this.process && !this.process.killed) {
        this.process.kill('SIGTERM')
      }
      this.process = null
      this.status = 'idle'
      this.monitorFormat = null
      this.monitorForwarding = false
      this.monitorPipeEnabled = false
      this.resetMonitorAudioQueue()
      this.emit('monitor-stop')
      throw error
    }
  }

  async prepareBackendCapture(config) {
    if (config.inputType === 'device') {
      await this.prepareInputDevicePipe(config)
    }
  }

  attachBackendInputPipe(config) {
    if (config.inputType === 'device') {
      this.attachInputDevicePipe()
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

    if (this.monitorPipeEnabled && this.monitorFormat && this.process.stdio[3]) {
      this.emit('monitor-format', this.monitorFormat)
      this.process.stdio[3].on('data', (data) => {
        const chunk = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        if (this.monitorForwarding) {
          this.queueMonitorAudio(chunk)
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
      this.cleanupInputDeviceProcess()
      this.process = null
      this.status = 'idle'
      this.monitorForwarding = false
      this.monitorPipeEnabled = false
      this.resetMonitorAudioQueue()
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
      this.rememberFfmpegLines(visibleLines)
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

  pipeBackendProcessToFfmpeg(backendProcess, { forwardMonitor = false } = {}) {
    backendProcess.stdout.on('data', (data) => {
      if (forwardMonitor && this.monitorForwarding) {
        this.queueMonitorAudio(data)
      }

      if (!this.process?.stdin || this.process.stdin.destroyed) {
        return
      }

      const canContinue = this.process.stdin.write(data)
      if (!canContinue) {
        backendProcess.stdout.pause()
        this.process.stdin.once('drain', () => {
          if (backendProcess.stdout) {
            backendProcess.stdout.resume()
          }
        })
      }
    })
  }

  prepareInputDevicePipe(config) {
    if (!config.inputDeviceUID) {
      throw new Error('Audio Input streaming requires a backend device UID')
    }

    this.emit('log', {
      type: 'system',
      message: `Starting audio input PCM capture (${config.inputDeviceName || config.inputDeviceUID})`
    })
    this.inputDeviceProcess = audioBackend.spawnInputDevicePCMStream({
      deviceUID: config.inputDeviceUID,
      streamIndex: config.inputStreamIndex,
      channels: this.getDeviceInputChannels(config),
      sampleRate: this.getDeviceInputSampleRate(config)
    })
    this.inputDeviceProcess.stdout.pause()

    return new Promise((resolve, reject) => {
      let settled = false
      const settleResolve = () => {
        if (settled) return
        settled = true
        resolve(this.inputDeviceProcess)
      }
      const settleReject = (error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      const startupTimer = setTimeout(() => {
        settleReject(new Error('Timed out waiting for audio input format'))
      }, 1500)

      this.inputDeviceProcess.stderr.on('data', (data) => {
        const message = data.toString().trim()
        if (!message) return

        const parsed = this.tryParseJSON(message)
        if (parsed?.event === 'format') {
          config.inputSampleRate = parsed.sampleRate || config.inputSampleRate
          config.inputChannels = parsed.channels || config.inputChannels
          clearTimeout(startupTimer)
          this.emit('log', {
            type: 'system',
            message: `Input device format: ${parsed.channels}ch @ ${this.formatSampleRate(parsed.sampleRate)}, ${parsed.bitsPerChannel}-bit float`
          })
          settleResolve()
          return
        }

        if (parsed?.event === 'error') {
          clearTimeout(startupTimer)
          const error = new Error(parsed.message || 'Input device capture failed')
          this.emit('log', {
            type: 'error',
            message: `Input device capture error: ${error.message}`
          })
          settleReject(error)
          return
        }

        this.emit('log', { type: 'system', message: `Input device capture: ${message}` })
      })

      this.inputDeviceProcess.on('error', (error) => {
        clearTimeout(startupTimer)
        this.emit('log', {
          type: 'error',
          message: `Input device capture process error: ${error.message}`
        })
        settleReject(error)
      })

      this.inputDeviceProcess.on('close', (code) => {
        clearTimeout(startupTimer)
        if (!settled) {
          settleReject(new Error(`Input device capture exited during startup with code ${code}`))
        }
        if (this.process) {
          this.process.stdin.end()
        }
        this.emit('log', {
          type: code === 0 ? 'system' : 'error',
          message: `Input device capture exited with code ${code}`
        })
        this.inputDeviceProcess = null
      })
    })
  }

  attachInputDevicePipe() {
    if (!this.inputDeviceProcess) {
      throw new Error('Input device capture process is not running')
    }

    this.pipeBackendProcessToFfmpeg(this.inputDeviceProcess)
    this.inputDeviceProcess.stdout.resume()
  }

  startFileMonitor(config) {
    if (this.process) {
      throw new Error('Preview monitor is only available before streaming')
    }

    if (!config.inputPath) {
      throw new Error('File monitor requires a selected file')
    }

    this.stopPreviewMonitor()

    const outputChannels = this.getOutputChannels(config)
    const channels = this.getMonitorChannels(config, outputChannels)
    const sampleRate = this.getOutputSampleRate(config)
    const layout = this.channelLayoutFor(channels)
    this.monitorFormat = {
      mode: config.monitorMode || 'stereo-pair',
      latencyMs: this.getMonitorLatencyMs(config),
      lowLatency: this.shouldUseLowLatencyMonitor(config),
      sampleRate,
      channels
    }
    this.monitorPipeEnabled = false
    this.monitorForwarding = true
    this.emit('monitor-format', this.monitorFormat)
    this.emit('log', {
      type: 'system',
      message: `Starting file preview monitor (${channels}ch @ ${this.formatSampleRate(sampleRate)})`
    })

    const args = ['-hide_banner', '-loglevel', 'warning']
    if (config.loopFile !== false) {
      args.push('-stream_loop', '-1')
    }
    args.push('-re', '-i', config.inputPath, '-vn')

    args.push('-ar', String(sampleRate), '-ac', String(channels))
    if (layout) {
      args.push('-channel_layout', layout)
    }
    args.push('-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1')

    const monitorProcess = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.previewMonitorProcess = monitorProcess

    monitorProcess.stdout.on('data', (data) => {
      if (this.monitorForwarding) {
        this.queueMonitorAudio(data)
      }
    })

    monitorProcess.stderr.on('data', (data) => {
      const message = data.toString().trim()
      if (message) {
        this.emit('log', { type: 'ffmpeg', message })
      }
    })

    monitorProcess.on('error', (error) => {
      this.emit('log', {
        type: 'error',
        message: `File preview monitor process error: ${error.message}`
      })
    })

    monitorProcess.on('close', (code) => {
      if (this.previewMonitorProcess !== monitorProcess) return

      this.emit('log', {
        type: code === 0 ? 'system' : 'error',
        message: `File preview monitor exited with code ${code}`
      })
      this.previewMonitorProcess = null
      if (!this.process) {
        this.monitorForwarding = false
        this.monitorPipeEnabled = false
        this.resetMonitorAudioQueue()
        this.emit('monitor-stop')
      }
    })

    return { success: true }
  }

  startInputDeviceMonitor(config) {
    if (this.process) {
      throw new Error('Preview monitor is only available before streaming')
    }
    this.validateBackendSupport(config)

    if (!config.inputPath) {
      throw new Error('Audio Input monitor requires a valid audio input')
    }

    if (!config.inputDeviceUID) {
      throw new Error('Audio Input monitor requires a backend device UID')
    }

    this.stopPreviewMonitor()

    const sampleRate = this.getOutputSampleRate(config)
    const inputChannels = this.getDeviceInputChannels(config)
    const channels = inputChannels
    this.monitorFormat = {
      mode: config.monitorMode || 'stereo-pair',
      latencyMs: this.getMonitorLatencyMs(config),
      lowLatency: this.shouldUseLowLatencyMonitor(config),
      sampleRate,
      channels
    }
    this.monitorPipeEnabled = false
    this.monitorForwarding = true
    this.emit('monitor-format', this.monitorFormat)
    this.emit('log', {
      type: 'system',
      message: `Starting audio input preview monitor (${channels}ch @ ${this.formatSampleRate(sampleRate)})`
    })

    const monitorProcess = audioBackend.spawnInputDevicePCMStream({
      deviceUID: config.inputDeviceUID,
      streamIndex: config.inputStreamIndex,
      channels,
      sampleRate
    })
    this.previewMonitorProcess = monitorProcess

    monitorProcess.stdout.on('data', (data) => {
      if (this.monitorForwarding) {
        this.queueMonitorAudio(data)
      }
    })

    monitorProcess.stderr.on('data', (data) => {
      const message = data.toString().trim()
      if (!message) return

      const parsed = this.tryParseJSON(message)
      if (parsed?.event === 'format') {
        const nextFormat = {
          mode: config.monitorMode || 'stereo-pair',
          latencyMs: this.getMonitorLatencyMs(config),
          lowLatency: this.shouldUseLowLatencyMonitor(config),
          sampleRate: parsed.sampleRate || sampleRate,
          channels: parsed.channels || channels
        }
        this.monitorFormat = nextFormat
        this.emit('monitor-format', nextFormat)
        this.emit('log', {
          type: 'system',
          message: `Input device preview format: ${nextFormat.channels}ch @ ${this.formatSampleRate(nextFormat.sampleRate)}`
        })
        return
      }

      if (parsed?.event === 'error') {
        this.emit('log', {
          type: 'error',
          message: `Input device preview error: ${parsed.message}`
        })
        return
      }

      this.emit('log', { type: 'system', message: `Input device preview: ${message}` })
    })

    monitorProcess.on('error', (error) => {
      this.emit('log', {
        type: 'error',
        message: `Input device preview monitor process error: ${error.message}`
      })
    })

    monitorProcess.on('close', (code) => {
      if (this.previewMonitorProcess !== monitorProcess) return

      this.emit('log', {
        type: code === 0 ? 'system' : 'error',
        message: `Input device preview monitor exited with code ${code}`
      })
      this.previewMonitorProcess = null
      if (!this.process) {
        this.monitorForwarding = false
        this.monitorPipeEnabled = false
        this.resetMonitorAudioQueue()
        this.emit('monitor-stop')
      }
    })

    return { success: true }
  }

  startNativeInputDeviceMonitor(config) {
    if (!audioBackend.getCapabilities().nativeInputDeviceMonitor) {
      throw new Error('Native Audio Input monitor is not available with the current audio backend')
    }

    if (!config.inputDeviceUID) {
      throw new Error('Native Audio Input monitor requires a backend device UID')
    }

    this.stopPreviewMonitor()
    this.monitorFormat = {
      mode: config.monitorMode || 'stereo-pair',
      latencyMs: this.getMonitorLatencyMs(config),
      lowLatency: true,
      sampleRate: this.getDeviceInputSampleRate(config),
      channels: 2
    }
    this.monitorPipeEnabled = false
    this.monitorForwarding = false
    this.previewMonitorKind = 'native-input'
    this.emit('monitor-format', this.monitorFormat)
    this.emit('log', {
      type: 'system',
      message: `Starting native audio input monitor (${config.monitorOutputDeviceName || 'System Default'})`
    })

    const monitorProcess = audioBackend.spawnNativeInputDeviceMonitor({
      deviceUID: config.inputDeviceUID,
      streamIndex: config.inputStreamIndex,
      outputDeviceName: config.monitorOutputDeviceName,
      pairStart: config.monitorPairStart,
      bufferFrames: this.nativeMonitorBufferFrames(config)
    })
    this.previewMonitorProcess = monitorProcess

    monitorProcess.stderr.on('data', (data) => {
      const message = data.toString().trim()
      if (!message) return

      const parsed = this.tryParseJSON(message)
      if (parsed?.event === 'format') {
        this.monitorFormat = {
          mode: config.monitorMode || 'stereo-pair',
          latencyMs: this.getMonitorLatencyMs(config),
          lowLatency: true,
          sampleRate: parsed.sampleRate || this.getDeviceInputSampleRate(config),
          channels: parsed.channels || 2
        }
        this.emit('monitor-format', this.monitorFormat)
        this.emit('log', {
          type: 'system',
          message: `Native monitor format: ${this.monitorFormat.channels}ch @ ${this.formatSampleRate(this.monitorFormat.sampleRate)}`
        })
        return
      }

      if (parsed?.event === 'error') {
        this.emit('log', { type: 'error', message: `Native monitor error: ${parsed.message}` })
        return
      }

      this.emit('log', { type: 'system', message: `Native monitor: ${message}` })
    })

    monitorProcess.on('error', (error) => {
      this.emit('log', {
        type: 'error',
        message: `Native monitor process error: ${error.message}`
      })
    })

    monitorProcess.on('close', (code) => {
      if (this.previewMonitorProcess !== monitorProcess) return

      this.emit('log', {
        type: code === 0 ? 'system' : 'error',
        message: `Native monitor exited with code ${code}`
      })
      this.previewMonitorProcess = null
      this.previewMonitorKind = null
      if (!this.process) {
        this.monitorForwarding = false
        this.monitorPipeEnabled = false
        this.resetMonitorAudioQueue()
        this.emit('monitor-stop')
      }
    })

    return { success: true }
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
          const stderr = this.startupErrorLog()
          const detail = stderr ? `: ${this.lastMeaningfulLine(stderr)}` : ''
          reject(new Error(`FFmpeg exited during startup with code ${code}${detail}`))
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
      this.cleanupInputDeviceProcess()
      this.process.kill('SIGTERM')
      this.monitorForwarding = false
      this.monitorPipeEnabled = false
      this.resetMonitorAudioQueue()
      this.emit('monitor-stop')
    })
  }

  async shutdown() {
    const processes = [this.previewMonitorProcess, this.inputDeviceProcess, this.process].filter(
      Boolean
    )

    this.previewMonitorProcess = null
    this.previewMonitorKind = null
    this.inputDeviceProcess = null
    this.process = null
    this.status = 'idle'
    this.monitorFormat = null
    this.monitorForwarding = false
    this.monitorPipeEnabled = false
    this.resetMonitorAudioQueue()
    this.emit('monitor-stop')
    this.emit('status', this.getStatus())

    await Promise.all(processes.map((processToStop) => this.terminateProcess(processToStop)))
  }

  stopPreviewMonitor() {
    if (!this.previewMonitorProcess) {
      return { success: true }
    }

    const processToStop = this.previewMonitorProcess
    this.previewMonitorProcess = null
    this.previewMonitorKind = null
    this.monitorForwarding = false
    this.monitorPipeEnabled = false
    this.resetMonitorAudioQueue()
    if (!processToStop.killed) {
      processToStop.kill('SIGTERM')
    }
    return { success: true }
  }

  setMonitorActive(isActive) {
    this.monitorForwarding = !!isActive
    if (!this.monitorForwarding) {
      this.resetMonitorAudioQueue()
    }
  }

  cleanupInputDeviceProcess() {
    if (!this.inputDeviceProcess) {
      return
    }

    const processToStop = this.inputDeviceProcess
    this.inputDeviceProcess = null
    if (!processToStop.killed) {
      processToStop.kill('SIGTERM')
    }
  }

  terminateProcess(processToStop, timeoutMs = 1500) {
    if (!processToStop || processToStop.exitCode !== null || processToStop.signalCode !== null) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        resolve()
      }

      processToStop.once('close', finish)
      processToStop.once('exit', finish)

      try {
        processToStop.kill('SIGTERM')
      } catch {
        finish()
        return
      }

      setTimeout(() => {
        if (finished) return
        try {
          processToStop.kill('SIGKILL')
        } catch {
          finish()
        }
      }, timeoutMs)

      setTimeout(finish, timeoutMs + 500)
    })
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
    const outputLayout = this.channelLayoutFor(outputChannels, config)
    const monitorEnabled = this.shouldUseFfmpegMonitor(config)

    args.push(...this.buildInputArgs(config, { inputType, inputPath, loopFile }))

    args.push('-vn')

    args.push(
      '-filter_complex',
      this.buildStreamFilterGraph(config, outputChannels, monitorEnabled)
    )
    args.push('-map', '[enc]')

    args.push('-ar', String(outputSampleRate))
    args.push('-ac', String(outputChannels))
    if (outputLayout) {
      args.push('-channel_layout', outputLayout)
    }
    args.push('-c:a', 'libopus')
    args.push('-b:a', bitrate)
    args.push('-vbr', 'constrained')
    args.push('-compression_level', '5')
    args.push('-application', 'audio')
    const mappingFamily = this.opusMappingFamily(outputChannels, outputLayout)
    if (mappingFamily !== null) {
      args.push('-mapping_family', String(mappingFamily))
    }
    args.push('-frame_duration', '20')
    args.push('-f', 'ogg')
    args.push('-content_type', 'audio/ogg')

    const encodedPassword = encodeURIComponent(sourcePassword || '')
    const icecastUrl = `icecast://source:${encodedPassword}@${icecastHost}:${icecastPort}${mountPoint}`
    args.push(icecastUrl)

    if (monitorEnabled) {
      const monitorChannels = this.getMonitorChannels(config, outputChannels)
      args.push('-map', '[mon]')
      args.push('-ar', String(outputSampleRate))
      args.push('-ac', String(monitorChannels))
      args.push('-c:a', 'pcm_f32le')
      args.push('-flush_packets', '1')
      args.push('-f', 'f32le')
      args.push('pipe:3')
    }

    return args
  }

  buildInputArgs(config, { inputType, inputPath, loopFile }) {
    if (inputType === 'file') {
      const args = []
      if (loopFile) {
        args.push('-stream_loop', '-1')
      }
      args.push('-re', '-i', inputPath)
      return args
    }

    if (inputType === 'device') {
      return this.buildBackendPcmInputArgs(config)
    }

    throw new Error(`Unsupported input source: ${inputType || 'unknown'}`)
  }

  buildBackendPcmInputArgs(config) {
    const channels = this.getBackendInputChannels(config)
    const sampleRate = this.getBackendInputSampleRate(config)
    const layout = this.channelLayoutFor(channels)
    const args = [
      '-fflags',
      'nobuffer',
      '-f',
      'f32le',
      '-ar',
      String(sampleRate),
      '-ac',
      String(channels)
    ]
    if (layout) {
      args.push('-channel_layout', layout)
    }
    args.push('-i', 'pipe:0')
    return args
  }

  buildStreamFilterGraph(config, outputChannels, monitorEnabled) {
    const filters = this.buildPreEncodeFilters(config, outputChannels)
    const prefix = filters.length > 0 ? `${filters.join(',')},` : ''
    const meterFilters = this.buildMeterFilters(outputChannels, this.getOutputSampleRate(config))

    if (!monitorEnabled) {
      return `[0:a]${prefix}asplit=2[enc][meterbase];[meterbase]${meterFilters.join(',')},anullsink`
    }

    const monitorFilter = this.buildMonitorFilter(config, outputChannels)
    const streamChain = prefix
      ? `[streambase]${prefix.slice(0, -1)}[enc]`
      : '[streambase]anull[enc]'
    const meterChain = prefix
      ? `[meterbase]${prefix}${meterFilters.join(',')},anullsink`
      : `[meterbase]${meterFilters.join(',')},anullsink`
    return `[0:a]asplit=3[streambase][monbase][meterbase];${streamChain};${meterChain};[monbase]${monitorFilter}[mon]`
  }

  buildPreEncodeFilters(config, outputChannels) {
    const filters = []
    if (config?.inputType === 'device') {
      filters.push(`aresample=${this.getOutputSampleRate(config)}:first_pts=0`)
    }

    const channelSelection = this.getChannelSelection(config, outputChannels)
    const inputChannels = this.getPreEncodeInputChannels(config, channelSelection, outputChannels)
    const needsPan =
      channelSelection.some((sourceIndex, outputIndex) => sourceIndex !== outputIndex) ||
      inputChannels !== outputChannels

    if (needsPan) {
      const layout = this.channelLayoutFor(outputChannels, config) || `${outputChannels}c`
      const mappings = channelSelection
        .map((sourceIndex, outputIndex) => `c${outputIndex}=c${sourceIndex}`)
        .join('|')
      filters.push(`pan=${layout}|${mappings}`)
    }

    return filters
  }

  getPreEncodeInputChannels(config, channelSelection = [], fallbackChannels = 2) {
    let channels = 0
    if (config?.inputType === 'device') {
      channels = this.getDeviceInputChannels(config)
    } else {
      const explicit = Number(config?.inputChannels)
      if (Number.isInteger(explicit) && explicit > 0) {
        channels = explicit
      }
    }

    const selectedExtent = channelSelection.length > 0 ? Math.max(...channelSelection) + 1 : 0
    return Math.max(1, channels || selectedExtent || fallbackChannels)
  }

  buildMeterFilters(outputChannels, sampleRate = 48000) {
    const meterFrames = Math.max(1024, Math.floor(Number(sampleRate || 48000) / 20))
    const filters = [`asetnsamples=n=${meterFrames}:p=0`, 'astats=metadata=1:reset=1']
    for (let channel = 1; channel <= Math.min(outputChannels, 16); channel += 1) {
      filters.push(`ametadata=print:key=lavfi.astats.${channel}.Peak_level`)
    }
    return filters
  }

  buildMonitorFilter() {
    return 'anull'
  }

  getMonitorChannels(config, outputChannels = this.getOutputChannels(config)) {
    const channelSelection = this.getChannelSelection(config, outputChannels)
    return this.getPreEncodeInputChannels(config, channelSelection, outputChannels)
  }

  getMonitorFormat(config) {
    const outputChannels = this.getOutputChannels(config)
    return {
      mode: config.monitorMode || 'stereo-pair',
      latencyMs: this.getMonitorLatencyMs(config),
      lowLatency: this.shouldUseLowLatencyMonitor(config),
      sampleRate: this.getOutputSampleRate(config),
      channels: this.getMonitorChannels(config, outputChannels)
    }
  }

  getMonitorLatencyMs(config) {
    const latency = Number(config?.monitorLatencyMs || 80)
    if (!Number.isFinite(latency)) return 80
    return Math.max(5, Math.min(500, latency))
  }

  nativeMonitorBufferFrames(config) {
    return this.shouldUseLowLatencyMonitor(config) ? 64 : 128
  }

  shouldUseLowLatencyMonitor(config) {
    return !!config?.monitorLowLatency
  }

  shouldUseFfmpegMonitor(config) {
    if (config?.directInputMonitor) return false
    return true
  }

  getBackendInputChannels(config) {
    if (config?.inputType === 'device') {
      return this.getDeviceInputChannels(config)
    }

    return this.getOutputChannels(config)
  }

  getBackendInputSampleRate(config) {
    if (config?.inputType === 'device') {
      return this.getDeviceInputSampleRate(config)
    }

    return this.getOutputSampleRate(config)
  }

  getDeviceInputChannels(config) {
    const channels = Number(config.inputChannels)
    if (Number.isInteger(channels) && channels > 0) {
      return channels
    }
    return 2
  }

  getDeviceInputSampleRate(config) {
    const sampleRate = Number(config.inputSampleRate || config.sampleRate)
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

    const channels = fallbackChannels || 6
    return Array.from({ length: channels }, (_value, index) => index)
  }

  getOutputSampleRate(config) {
    const sampleRate = Number(config?.sampleRate)
    if (Number.isFinite(sampleRate) && sampleRate > 0) {
      return this.opusSampleRate(sampleRate)
    }

    return 48000
  }

  channelLayoutFor(channels, config = null) {
    if (
      config?.streamChannelLayout &&
      this.layoutChannelCount(config.streamChannelLayout) === channels
    ) {
      return config.streamChannelLayout
    }

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

  layoutChannelCount(layout) {
    if (!layout || typeof layout !== 'string') return 0
    if (layout.includes('+')) {
      return layout.split('+').filter(Boolean).length
    }
    const layouts = {
      mono: 1,
      stereo: 2,
      2.1: 3,
      '3.0': 3,
      3.1: 4,
      quad: 4,
      '5.0': 5,
      '5.0(side)': 5,
      5.1: 6,
      '5.1(side)': 6,
      7.1: 8,
      '7.1(top)': 8
    }
    return layouts[layout] || 0
  }

  opusMappingFamily(channels, layout) {
    if (channels <= 2) return null
    if (channels > 8 || layout?.includes('+')) return 255
    return 1
  }

  opusSampleRate(sampleRate) {
    const supportedRates = [48000, 24000, 16000, 12000, 8000]
    const numeric = Math.round(Number(sampleRate))
    return supportedRates.includes(numeric) ? numeric : 48000
  }

  formatSampleRate(sampleRate) {
    const numeric = Number(sampleRate)
    if (!Number.isFinite(numeric) || numeric <= 0) return '?'
    const khz = numeric / 1000
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`
  }

  queueMonitorAudio(data) {
    if (!this.monitorForwarding || !data?.byteLength) return

    const buffer = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength)
    this.monitorAudioBuffers.push(buffer)
    this.monitorAudioBytes += buffer.byteLength

    if (this.monitorAudioBytes >= this.monitorAudioTargetBytes()) {
      this.flushMonitorAudio()
      return
    }

    if (!this.monitorAudioFlushTimer) {
      const flushDelayMs = this.shouldFlushMonitorAudioLowLatency() ? 2 : 10
      this.monitorAudioFlushTimer = setTimeout(() => {
        this.monitorAudioFlushTimer = null
        this.flushMonitorAudio()
      }, flushDelayMs)
    }
  }

  flushMonitorAudio() {
    if (this.monitorAudioFlushTimer) {
      clearTimeout(this.monitorAudioFlushTimer)
      this.monitorAudioFlushTimer = null
    }

    if (!this.monitorForwarding || this.monitorAudioBytes === 0) {
      this.resetMonitorAudioQueue()
      return
    }

    const data =
      this.monitorAudioBuffers.length === 1
        ? this.monitorAudioBuffers[0]
        : Buffer.concat(this.monitorAudioBuffers, this.monitorAudioBytes)
    const frameBytes = this.monitorAudioFrameBytes()
    const sendBytes = Math.floor(data.byteLength / frameBytes) * frameBytes

    if (sendBytes <= 0) {
      this.monitorAudioBuffers = [data]
      this.monitorAudioBytes = data.byteLength
      return
    }

    const sendData = sendBytes === data.byteLength ? data : data.subarray(0, sendBytes)
    const remainder = sendBytes < data.byteLength ? Buffer.from(data.subarray(sendBytes)) : null
    this.monitorAudioBuffers = remainder ? [remainder] : []
    this.monitorAudioBytes = remainder ? remainder.byteLength : 0
    this.emit('monitor-audio', { chunk: this.toArrayBuffer(sendData) })
  }

  resetMonitorAudioQueue() {
    if (this.monitorAudioFlushTimer) {
      clearTimeout(this.monitorAudioFlushTimer)
      this.monitorAudioFlushTimer = null
    }
    this.monitorAudioBuffers = []
    this.monitorAudioBytes = 0
  }

  monitorAudioTargetBytes() {
    const sampleRate = Math.max(1, Number(this.monitorFormat?.sampleRate || 48000))
    const frameBytes = this.monitorAudioFrameBytes()
    const bufferSeconds = this.shouldFlushMonitorAudioLowLatency() ? 0.005 : 0.02
    const minFrames = this.shouldFlushMonitorAudioLowLatency() ? 128 : Math.ceil(4096 / frameBytes)
    return Math.max(frameBytes * minFrames, Math.floor(sampleRate * frameBytes * bufferSeconds))
  }

  monitorAudioFrameBytes() {
    const channels = Math.max(1, Number(this.monitorFormat?.channels || 2))
    return channels * 4
  }

  shouldFlushMonitorAudioLowLatency() {
    return !!this.monitorFormat?.lowLatency
  }

  redactArgs(args) {
    return args.map((arg) => arg.replace(/(icecast:\/\/source:)[^@]+@/, '$1******@'))
  }

  lastMeaningfulLine(text) {
    return String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-3)
      .join(' / ')
  }

  rememberFfmpegLines(lines) {
    const normalized = lines.map((line) => line.trim()).filter(Boolean)
    if (normalized.length === 0) return
    this.recentFfmpegLines.push(...normalized)
    if (this.recentFfmpegLines.length > 30) {
      this.recentFfmpegLines = this.recentFfmpegLines.slice(-30)
    }
  }

  startupErrorLog() {
    const buffered = this.ffmpegStderrBuffer.trim()
    if (buffered) {
      return buffered
    }
    return this.recentFfmpegLines.join('\n').trim()
  }

  toArrayBuffer(data) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
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
