import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import windowsDshowBackend from './windows-dshow'

const DEFAULT_SAMPLE_RATE = 48000
const DEFAULT_CHANNELS = 2
const MINIMUM_WINDOWS_BUILD = 20348

class WindowsWasapiBackend {
  getCapabilities() {
    const helperAvailable = this.isHelperAvailable()
    return {
      platform: 'win32',
      backendName: helperAvailable ? 'windows-wasapi-process-loopback' : 'windows-wasapi-pending',
      appAudioCapture: helperAvailable,
      appAudioPerProcess: helperAvailable,
      appAudioSurroundPreserve: false,
      inputDeviceCapture: true,
      inputDeviceMonitor: true,
      fileSource: true,
      monitorPlayback: true,
      monitorDeviceEnumeration: false,
      outputLoopbackCapture: false,
      minimumWindowsBuild: MINIMUM_WINDOWS_BUILD
    }
  }

  async listInputDevices() {
    if (!this.isHelperAvailable()) {
      return await windowsDshowBackend.listInputDevices()
    }

    const result = await this.runHelper(['--list-input-devices'])
    return (result.devices || []).map((device, index) => ({
      index: String(device.index ?? index),
      name: device.name || `Windows Audio Input ${index + 1}`,
      deviceUID: device.deviceUID,
      sampleRate: Number(device.sampleRate) || DEFAULT_SAMPLE_RATE,
      channels: Number(device.channels) || DEFAULT_CHANNELS,
      bitsPerChannel: Number(device.bitsPerChannel) || 32,
      backend: 'wasapi-mmdevice'
    }))
  }

  async listInputStreams() {
    if (!this.isHelperAvailable()) {
      return await windowsDshowBackend.listInputStreams()
    }

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

  spawnInputDevicePCMStream(options = {}) {
    if (!this.isHelperAvailable()) {
      return windowsDshowBackend.spawnInputDevicePCMStream(options)
    }

    if (!options.deviceUID) {
      throw new Error('WASAPI input capture requires an MMDevice endpoint id')
    }

    return spawn(
      this.getHelperPath(),
      ['--stream-input-device', '--device-id', String(options.deviceUID)],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
  }

  async listAppProcesses() {
    this.assertHelperAvailable()
    const result = await this.runPowershell([
      'Get-Process',
      '|',
      'Where-Object',
      '{ $_.MainWindowTitle }',
      '|',
      'Select-Object',
      'Id,ProcessName,MainWindowTitle',
      '|',
      'ConvertTo-Json',
      '-Compress'
    ])
    const entries = this.parseJsonArray(result.stdout)
    return {
      processes: entries
        .map((process) => ({
          pid: Number(process.Id),
          name: this.processDisplayName(process),
          isRunningOutput: true,
          isPerProcess: true
        }))
        .filter((process) => Number.isInteger(process.pid) && process.pid > 0 && process.name)
        .sort((left, right) => left.name.localeCompare(right.name))
    }
  }

  async listAppOutputStreams() {
    this.assertHelperAvailable()
    const result = await this.runHelper(['--list-output-devices'])
    const devices = (result.devices || []).map((device, index) => {
      const sampleRate = Number(device.sampleRate) || DEFAULT_SAMPLE_RATE
      const channels = Number(device.channels) || DEFAULT_CHANNELS
      return {
        name: device.name || `Windows Audio Output ${index + 1}`,
        deviceUID: device.deviceUID || `wasapi-render-${index}`,
        streams: [
          {
            streamIndex: 0,
            sampleRate,
            channels,
            bitsPerChannel: 32
          }
        ]
      }
    })

    return {
      devices:
        devices.length > 0
          ? devices
          : [
              {
                name: 'WASAPI Process Loopback',
                deviceUID: 'wasapi-process-loopback',
                streams: [
                  {
                    streamIndex: 0,
                    sampleRate: DEFAULT_SAMPLE_RATE,
                    channels: DEFAULT_CHANNELS,
                    bitsPerChannel: 32
                  }
                ]
              }
            ]
    }
  }

  spawnAppAudioPCMStream(pid, options = {}) {
    this.assertHelperAvailable()
    const numericPid = Number(pid)
    if (!Number.isInteger(numericPid) || numericPid <= 0) {
      throw new Error('WASAPI process loopback requires a valid process id')
    }

    const sampleRate = this.normalizedSampleRate(options.sampleRate)
    const channels = this.normalizedChannels(options.channels)
    return spawn(
      this.getHelperPath(),
      [
        '--stream-process-loopback',
        '--pid',
        String(numericPid),
        '--sample-rate',
        String(sampleRate),
        '--channels',
        String(channels),
        '--mode',
        options.loopbackMode === 'exclude-tree' ? 'exclude-tree' : 'include-tree'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
  }

  getHelperPath() {
    const packagedPaths = [
      join(process.resourcesPath, 'audio-backend.exe'),
      join(
        process.resourcesPath,
        'app.asar.unpacked',
        'native/audio-backends/windows/.build/SurroundAudioBackend.exe'
      )
    ]
    if (app.isPackaged) {
      const packagedPath = packagedPaths.find((path) => existsSync(path))
      if (packagedPath) return packagedPath
    }

    return resolve(process.cwd(), 'native/audio-backends/windows/.build/SurroundAudioBackend.exe')
  }

  isHelperAvailable() {
    return existsSync(this.getHelperPath())
  }

  assertHelperAvailable() {
    const helperPath = this.getHelperPath()
    if (!existsSync(helperPath)) {
      throw new Error(
        `Windows WASAPI helper not found: ${helperPath}. Build it with npm run build:audio-helper:win.`
      )
    }
  }

  normalizedSampleRate(sampleRate) {
    const numeric = Math.round(Number(sampleRate || DEFAULT_SAMPLE_RATE))
    return Number.isFinite(numeric) && numeric >= 8000 ? numeric : DEFAULT_SAMPLE_RATE
  }

  normalizedChannels(channels) {
    const numeric = Number(channels || DEFAULT_CHANNELS)
    return Number.isInteger(numeric) && numeric >= 1 ? Math.min(numeric, 8) : DEFAULT_CHANNELS
  }

  processDisplayName(process) {
    const title = String(process.MainWindowTitle || '').trim()
    const name = String(process.ProcessName || '').trim()
    if (title && name) return `${title} (${name})`
    return title || name
  }

  parseJsonArray(value) {
    const text = String(value || '').trim()
    if (!text) return []

    try {
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return []
    }
  }

  runPowershell(commandParts) {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', commandParts.join(' ')],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })
      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `powershell.exe exited with code ${code}`))
          return
        }
        resolvePromise({ stdout, stderr })
      })
    })
  }

  runHelper(args) {
    return new Promise((resolvePromise, reject) => {
      this.assertHelperAvailable()
      const child = spawn(this.getHelperPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })
      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              stderr.trim() || stdout.trim() || `Windows audio helper exited with code ${code}`
            )
          )
          return
        }

        try {
          resolvePromise(JSON.parse(stdout))
        } catch (error) {
          reject(new Error(`Invalid Windows audio helper JSON: ${error.message}`))
        }
      })
    })
  }
}

export default new WindowsWasapiBackend()
