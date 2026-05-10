import ffmpeg from 'fluent-ffmpeg'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import net from 'net'
import { app } from 'electron'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
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
    this.shoutcast1RelaySocket = null
    this.shoutcast1RelayPipe = null
    this.shoutcast1RelayActive = false
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
    const shoutcast1RelayEnabled = this.shouldUseShoutcast1Relay(config)
    const shoutcast1RelayPipeIndex = shoutcast1RelayEnabled
      ? this.monitorPipeEnabled
        ? 4
        : 3
      : null

    try {
      await this.prepareBackendCapture(config)
      this.monitorFormat = this.getMonitorFormat(config)
      if (shoutcast1RelayEnabled) {
        await this.openShoutcast1Relay(this.normalizedMp3SimulcastConfig(config))
      }
    } catch (error) {
      this.cleanupInputDeviceProcess()
      this.closeShoutcast1Relay()
      this.status = 'idle'
      this.monitorForwarding = false
      this.monitorPipeEnabled = false
      throw error
    }

    const args = this.buildArgs(config, { shoutcast1RelayPipeIndex })

    this.emit('log', {
      type: 'system',
      message: `Starting FFmpeg: ${this.redactArgs(args).join(' ')}`
    })

    const stdio = this.buildFfmpegStdio({ shoutcast1RelayPipeIndex })
    this.process = spawn(ffmpegPath, args, { stdio })
    this.attachFfmpegEvents()
    this.attachShoutcast1RelayPipe(shoutcast1RelayPipeIndex)
    if (this.monitorFormat && !this.monitorPipeEnabled) {
      this.emit('monitor-format', this.monitorFormat)
    }

    try {
      this.attachBackendInputPipe(config)

      await this.waitForStartup()
      this.emit('status', this.getStatus())
    } catch (error) {
      this.cleanupInputDeviceProcess()
      this.closeShoutcast1Relay()
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

  buildFfmpegStdio({ shoutcast1RelayPipeIndex = null } = {}) {
    const stdio = ['pipe', 'pipe', 'pipe']
    if (this.monitorPipeEnabled) {
      stdio[3] = 'pipe'
    }
    if (shoutcast1RelayPipeIndex !== null) {
      stdio[shoutcast1RelayPipeIndex] = 'pipe'
    }
    return stdio
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
      this.closeShoutcast1Relay()
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

  attachShoutcast1RelayPipe(pipeIndex) {
    if (pipeIndex === null || !this.shoutcast1RelaySocket || !this.process?.stdio?.[pipeIndex]) {
      return
    }

    this.shoutcast1RelayPipe = this.process.stdio[pipeIndex]
    this.shoutcast1RelayPipe.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        this.emit('log', { type: 'error', message: `Shoutcast1 MP3 pipe error: ${error.message}` })
      }
    })
    this.shoutcast1RelayPipe.pipe(this.shoutcast1RelaySocket, { end: false })
    this.shoutcast1RelayPipe.on('end', () => {
      this.shoutcast1RelaySocket?.end()
    })
  }

  async openShoutcast1Relay(mp3Config) {
    const port = Number(mp3Config.port)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('MP3 Shoutcast1 port is invalid')
    }

    this.closeShoutcast1Relay()

    const ports = [port]
    if (port < 65535) {
      ports.push(port + 1)
    }

    let lastError = null
    for (const candidatePort of ports) {
      try {
        await this.openShoutcast1RelayOnPort(mp3Config, candidatePort)
        return
      } catch (error) {
        lastError = error
        this.emit('log', {
          type: 'error',
          message: `MP3 Shoutcast1 source connection failed on port ${candidatePort}: ${error.message}`
        })
        this.closeShoutcast1Relay()
      }
    }

    throw lastError || new Error('MP3 Shoutcast1 connection failed')
  }

  async openShoutcast1RelayOnPort(mp3Config, port) {
    const socket = net.createConnection({ host: mp3Config.host, port })
    socket.setNoDelay(true)
    socket.setKeepAlive(true)
    this.shoutcast1RelaySocket = socket
    this.shoutcast1RelayActive = true

    await new Promise((resolve, reject) => {
      let response = ''
      const timeout = setTimeout(() => {
        cleanup()
        socket.destroy()
        reject(new Error('MP3 Shoutcast1 authentication timed out'))
      }, 10000)

      const cleanup = () => {
        clearTimeout(timeout)
        socket.off('connect', onConnect)
        socket.off('data', onData)
        socket.off('error', onError)
        socket.off('close', onClose)
      }
      const onConnect = () => {
        socket.write(`${mp3Config.password}\r\n`)
      }
      const onData = (data) => {
        response += data.toString('latin1')
        if (/invalid/i.test(response)) {
          cleanup()
          socket.destroy()
          reject(new Error(`authentication failed: ${this.compactServerResponse(response)}`))
          return
        }
        if (/^OK2/i.test(response) || response.includes('\r\nOK2')) {
          cleanup()
          socket.write(this.buildShoutcast1Headers(mp3Config))
          resolve()
        }
      }
      const onError = (error) => {
        cleanup()
        reject(new Error(error.message))
      }
      const onClose = () => {
        cleanup()
        const detail = this.compactServerResponse(response)
        reject(
          new Error(
            detail
              ? `connection closed during authentication: ${detail}`
              : 'connection closed during authentication'
          )
        )
      }

      socket.once('connect', onConnect)
      socket.on('data', onData)
      socket.once('error', onError)
      socket.once('close', onClose)
    })

    socket.on('error', (error) => {
      if (!this.shoutcast1RelayActive) return
      this.emit('log', { type: 'error', message: `MP3 Shoutcast1 relay error: ${error.message}` })
      this.stopProcessAfterRelayFailure()
    })
    socket.on('close', () => {
      if (!this.shoutcast1RelayActive) return
      this.emit('log', { type: 'error', message: 'MP3 Shoutcast1 relay disconnected' })
      this.stopProcessAfterRelayFailure()
    })

    this.emit('log', {
      type: 'system',
      message: `MP3 Shoutcast1 relay connected to ${mp3Config.host}:${port}`
    })
  }

  compactServerResponse(response) {
    return String(response || '')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .slice(0, 240)
  }

  buildShoutcast1Headers(mp3Config) {
    const bitrateKbps = String(parseInt(mp3Config.bitrate, 10) || 128)
    return [
      'icy-name:SurroundStreamer',
      'icy-genre:Unknown',
      'icy-pub:0',
      `icy-br:${bitrateKbps}`,
      'icy-url:',
      'content-type:audio/mpeg',
      '',
      ''
    ].join('\r\n')
  }

  stopProcessAfterRelayFailure() {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM')
    }
  }

  closeShoutcast1Relay() {
    this.shoutcast1RelayActive = false
    if (this.shoutcast1RelayPipe) {
      this.shoutcast1RelayPipe.unpipe(this.shoutcast1RelaySocket || undefined)
      this.shoutcast1RelayPipe = null
    }
    if (this.shoutcast1RelaySocket) {
      this.shoutcast1RelaySocket.destroy()
      this.shoutcast1RelaySocket = null
    }
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
      this.emit('log', { type: 'ffmpeg', message: this.redactText(message) })
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
      this.closeShoutcast1Relay()
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
    this.closeShoutcast1Relay()
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

  buildArgs(config, { shoutcast1RelayPipeIndex = null } = {}) {
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
    const opusStreamEnabled = this.shouldUseOpusStream(config)
    const mp3SimulcastEnabled = this.shouldUseMp3Simulcast(config)
    const mp3AudioMode = this.mp3AudioMode(config)
    const mp3HrtfLabels =
      mp3SimulcastEnabled && mp3AudioMode === 'hrtf'
        ? this.mp3HrtfLabels(config, outputChannels)
        : []

    args.push(...this.buildInputArgs(config, { inputType, inputPath, loopFile }))
    args.push(...this.buildHrtfInputArgs(mp3HrtfLabels))

    args.push('-vn')

    args.push(
      '-filter_complex',
      this.buildStreamFilterGraph(
        config,
        outputChannels,
        monitorEnabled,
        opusStreamEnabled,
        mp3SimulcastEnabled,
        { mp3AudioMode, mp3HrtfLabels }
      )
    )

    if (opusStreamEnabled) {
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
    }

    if (mp3SimulcastEnabled) {
      const mp3Config = this.normalizedMp3SimulcastConfig(config, {
        sampleRate: outputSampleRate
      })
      args.push('-map', '[mp3enc]')
      args.push('-ar', String(mp3Config.sampleRate))
      args.push('-ac', '2')
      args.push('-c:a', 'libmp3lame')
      args.push('-b:a', mp3Config.bitrate)
      if (mp3Config.serverType === 'shoutcast1') {
        if (shoutcast1RelayPipeIndex === null) {
          throw new Error('MP3 Shoutcast1 relay pipe is not configured')
        }
        args.push('-write_xing', '0')
        args.push('-f', 'mp3')
        args.push(`pipe:${shoutcast1RelayPipeIndex}`)
      } else {
        args.push('-content_type', 'audio/mpeg')
        args.push('-f', 'mp3')
        args.push(this.mp3SimulcastUrl(mp3Config))
      }
    }

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

  buildHrtfInputArgs(labels) {
    return labels.flatMap((label) => ['-i', this.hrtfPathFor(label)])
  }

  buildStreamFilterGraph(
    config,
    outputChannels,
    monitorEnabled,
    opusStreamEnabled = true,
    mp3SimulcastEnabled = false,
    { mp3AudioMode = 'stereo', mp3HrtfLabels = [] } = {}
  ) {
    const filters = this.buildPreEncodeFilters(config, outputChannels)
    const meterFilters = this.buildMeterFilters(outputChannels, this.getOutputSampleRate(config))
    const encodedOutputs = ['[meterbase]']
    if (opusStreamEnabled) {
      encodedOutputs.push('[encbase]')
    }
    if (mp3SimulcastEnabled) {
      encodedOutputs.push('[mp3base]')
    }
    const encodedSplit =
      encodedOutputs.length > 1
        ? `asplit=${encodedOutputs.length}${encodedOutputs.join('')}`
        : 'anull[encbase]'
    const encodedSource = monitorEnabled ? '[streambase]' : '[0:a]'
    const encodedChain = `${encodedSource}${this.filterChain(filters, encodedSplit)}`
    const chains = [encodedChain, `[meterbase]${meterFilters.join(',')},anullsink`]

    if (opusStreamEnabled) {
      chains.push('[encbase]anull[enc]')
    }

    if (mp3SimulcastEnabled) {
      chains.push(
        this.buildMp3FilterChain(
          '[mp3base]',
          '[mp3enc]',
          outputChannels,
          mp3AudioMode,
          mp3HrtfLabels
        )
      )
    }

    if (monitorEnabled) {
      chains.unshift('[0:a]asplit=2[streambase][monbase]')
      chains.push(`[monbase]${this.buildMonitorFilter(config, outputChannels)}[mon]`)
    }

    return chains.join(';')
  }

  filterChain(filters, tail) {
    return filters.length > 0 ? `${filters.join(',')},${tail}` : tail
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

  buildMp3FilterChain(inputLabel, outputLabel, outputChannels, mode, hrtfLabels) {
    if (mode === 'hrtf') {
      const inputs = hrtfLabels.map((_label, index) => `[${index + 1}:a]`).join('')
      return `${inputLabel}${this.buildMp3HrtfInputFilter(outputChannels, hrtfLabels)}[mp3hrtfbase];[mp3hrtfbase]${inputs}headphone=map=${hrtfLabels.join('|')}:hrir=stereo:gain=-9.118639${outputLabel}`
    }

    const filter =
      mode === 'downmix'
        ? this.buildMp3DownmixFilter(outputChannels)
        : this.buildMp3StereoPairFilter(outputChannels)
    return `${inputLabel}${filter}${outputLabel}`
  }

  buildMp3StereoPairFilter(outputChannels) {
    const channels = Math.max(1, Number(outputChannels || 2))
    if (channels === 1) {
      return 'pan=stereo|c0=c0|c1=c0'
    }
    return 'pan=stereo|c0=c0|c1=c1'
  }

  buildMp3DownmixFilter(outputChannels) {
    const channels = Math.max(1, Number(outputChannels || 2))
    if (channels === 1) {
      return 'pan=stereo|c0=c0|c1=c0,volume=0.707'
    }

    const leftTerms = ['c0']
    const rightTerms = ['c1']
    if (channels >= 3) {
      leftTerms.push('0.707*c2')
      rightTerms.push('0.707*c2')
    }
    if (channels >= 6) {
      leftTerms.push('0.707*c4')
      rightTerms.push('0.707*c5')
    }
    if (channels >= 8) {
      leftTerms.push('0.707*c6')
      rightTerms.push('0.707*c7')
    }

    return `pan=stereo|c0=${leftTerms.join('+')}|c1=${rightTerms.join('+')},volume=0.707`
  }

  buildMp3HrtfInputFilter(outputChannels, hrtfLabels) {
    const channels = Math.max(1, Number(outputChannels || 2))
    const layout = this.channelLayoutFor(channels) || `${channels}c`
    const terms = Array.from({ length: channels }, (_value, index) => {
      const gain = this.spatialChannelGain(hrtfLabels[index], index)
      return `c${index}=${gain}*c${index}`
    })
    return `pan=${layout}|${terms.join('|')}`
  }

  spatialChannelGain(label, index) {
    const value = this.normalizeHrtfLabel(label || this.defaultHrtfLabel(index))
    if (value === 'LFE') return '0'
    if (value === 'FC') return '0.707'
    if (['SL', 'SR', 'BL', 'BR', 'TFL', 'TFR', 'TBL', 'TBR'].includes(value)) return '0.707'
    return '1'
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

  shouldUseMp3Simulcast(config) {
    return !!config?.mp3Simulcast?.enabled
  }

  mp3AudioMode(config) {
    const mode = config?.mp3Simulcast?.audioMode
    return ['stereo', 'downmix', 'hrtf'].includes(mode) ? mode : 'stereo'
  }

  mp3HrtfLabels(config, outputChannels) {
    const labels = Array.isArray(config?.streamChannelLabels) ? config.streamChannelLabels : []
    return Array.from({ length: Math.max(1, Number(outputChannels || 2)) }, (_value, index) => {
      return this.normalizeHrtfLabel(labels[index] || this.defaultHrtfLabel(index))
    })
  }

  defaultHrtfLabel(index) {
    return ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BL', 'BR'][index] || (index % 2 ? 'FR' : 'FL')
  }

  normalizeHrtfLabel(label) {
    const value = String(label || '').toUpperCase()
    const aliases = {
      L: 'FL',
      R: 'FR',
      C: 'FC',
      LS: 'SL',
      RS: 'SR',
      LSR: 'BL',
      RSR: 'BR'
    }
    return aliases[value] || value || 'FL'
  }

  hrtfPathFor(label) {
    const filename = `${this.normalizeHrtfLabel(label)}.wav`
    const candidates = app.isPackaged
      ? [
          join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'ku100-hrir', filename),
          join(process.resourcesPath, 'resources', 'ku100-hrir', filename)
        ]
      : [resolve(process.cwd(), 'resources', 'ku100-hrir', filename)]
    const path = candidates.find((candidate) => existsSync(candidate))
    if (!path) {
      throw new Error(`KU100 HRIR asset is missing: ${filename}`)
    }
    return path
  }

  shouldUseOpusStream(config) {
    return config?.encodingFormat !== 'mp3'
  }

  shouldUseShoutcast1Relay(config) {
    return this.shouldUseMp3Simulcast(config) && config?.mp3Simulcast?.serverType === 'shoutcast1'
  }

  normalizedMp3SimulcastConfig(config, { sampleRate = this.getOutputSampleRate(config) } = {}) {
    const mp3Config = config?.mp3Simulcast || {}
    const serverType = mp3Config.serverType === 'shoutcast1' ? 'shoutcast1' : 'icecast'
    return {
      serverType,
      host: String(mp3Config.host || '').trim(),
      port: String(mp3Config.port || '').trim(),
      mountPoint: this.normalizeMountPoint(mp3Config.mountPoint || '/stream.mp3'),
      password: String(mp3Config.password || ''),
      bitrate: this.normalizeMp3Bitrate(mp3Config.bitrate),
      sampleRate
    }
  }

  normalizeMp3Bitrate(value) {
    const bitrate = String(value || '128k')
      .trim()
      .toLowerCase()
    return /^\d+k$/.test(bitrate) ? bitrate : '128k'
  }

  normalizeMountPoint(value) {
    const mountPoint = String(value || '/stream.mp3').trim()
    if (!mountPoint) return '/stream.mp3'
    return mountPoint.startsWith('/') ? mountPoint : `/${mountPoint}`
  }

  mp3SimulcastUrl(config) {
    const encodedPassword = encodeURIComponent(config.password || '')
    return `icecast://source:${encodedPassword}@${config.host}:${config.port}${config.mountPoint}`
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
    return args.map((arg) => this.redactText(arg))
  }

  redactText(text) {
    return String(text).replace(/(icecast:\/\/source:)[^@]+@/g, '$1******@')
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
