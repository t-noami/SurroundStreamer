import ffmpeg from 'fluent-ffmpeg'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { getFfmpegPath } from './ffmpeg-path'

// Set ffmpeg path
const ffmpegPath = getFfmpegPath()
ffmpeg.setFfmpegPath(ffmpegPath)

class FFmpegManager extends EventEmitter {
  constructor() {
    super()
    this.process = null
    this.status = 'idle' // 'idle' | 'streaming' | 'error'
    this.config = null
  }

  async startStream(config) {
    if (this.process) {
      throw new Error('Stream is already running')
    }

    this.config = config
    this.status = 'streaming'

    const args = this.buildArgs(config)

    this.emit('log', {
      type: 'system',
      message: `Starting FFmpeg: ${this.redactArgs(args).join(' ')}`
    })

    this.process = spawn(ffmpegPath, args)

    this.process.stdout.on('data', (data) => {
      this.emit('log', { type: 'ffmpeg', message: data.toString().trim() })
    })

    this.process.stderr.on('data', (data) => {
      // FFmpeg outputs logs to stderr
      const log = data.toString()
      this.emit('log', { type: 'ffmpeg', message: log.trim() })
    })

    this.process.on('close', (code) => {
      this.emit('log', {
        type: code === 0 ? 'system' : 'error',
        message: `FFmpeg exited with code ${code}`
      })
      this.process = null
      this.status = 'idle'
      this.emit('status', this.getStatus())
    })

    this.process.on('error', (err) => {
      this.emit('log', { type: 'error', message: `FFmpeg process error: ${err.message}` })
      this.status = 'error'
      this.emit('status', this.getStatus())
    })

    await this.waitForStartup()
    this.emit('status', this.getStatus())
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
      this.process.kill('SIGTERM')
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

    // Input settings
    if (inputType === 'file') {
      if (loopFile) {
        args.push('-stream_loop', '-1')
      }
      args.push('-re') // Read at native frame rate
      args.push('-i', inputPath)
    } else if (inputType === 'device') {
      args.push('-f', 'avfoundation')
      args.push('-i', inputPath)
    }

    // Audio settings for 5.1
    args.push('-vn') // No video
    args.push('-ac', '6')
    args.push('-channel_layout', '5.1')
    args.push('-c:a', 'libopus')
    args.push('-b:a', bitrate)
    args.push('-vbr', 'on')
    args.push('-application', 'audio')
    args.push('-mapping_family', '1')
    args.push('-frame_duration', '20')

    // Output settings
    args.push('-f', 'ogg')
    args.push('-content_type', 'audio/ogg')

    const icecastUrl = `icecast://source:${sourcePassword}@${icecastHost}:${icecastPort}${mountPoint}`
    args.push(icecastUrl)

    return args
  }

  redactArgs(args) {
    return args.map((arg) => arg.replace(/(icecast:\/\/source:)[^@]+@/, '$1******@'))
  }
}

export default new FFmpegManager()
