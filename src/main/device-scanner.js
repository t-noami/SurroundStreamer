import { spawn } from 'child_process'
import { getFfmpegPath } from './ffmpeg-path'
import appAudioHelper from './app-audio-helper'

class DeviceScanner {
  async listAudioDevices() {
    const devices = await new Promise((resolve) => {
      const ffmpeg = spawn(getFfmpegPath(), [
        '-f',
        'avfoundation',
        '-list_devices',
        'true',
        '-i',
        ''
      ])

      let output = ''
      ffmpeg.stderr.on('data', (data) => {
        output += data.toString()
      })

      ffmpeg.on('close', () => {
        const devices = this.parseOutput(output)
        resolve(devices)
      })
    })

    try {
      const result = await appAudioHelper.listInputStreams()
      return this.mergeCoreAudioInfo(devices, result.devices || [])
    } catch {
      return devices
    }
  }

  parseOutput(output) {
    const devices = []
    const lines = output.split('\n')
    let isAudioSection = false

    for (const line of lines) {
      if (line.includes('AVFoundation audio devices:')) {
        isAudioSection = true
        continue
      }
      if (line.includes('AVFoundation video devices:')) {
        isAudioSection = false
        continue
      }

      if (isAudioSection) {
        // Example line: [AVFoundation input device @ 0x...] [0] Built-in Microphone
        const match = line.match(/\[(\d+)\]\s+(.+)$/)
        if (match) {
          devices.push({
            index: match[1],
            name: match[2].trim()
          })
        }
      }
    }

    return devices
  }

  mergeCoreAudioInfo(ffmpegDevices, coreAudioDevices) {
    const byName = new Map()
    for (const device of coreAudioDevices) {
      byName.set(this.normalizeName(device.name), device)
    }

    return ffmpegDevices.map((device) => {
      const coreAudio = byName.get(this.normalizeName(device.name))
      if (!coreAudio) {
        return {
          ...device,
          isLikelyLoopback: this.isLikelyLoopbackName(device.name)
        }
      }

      const stream = this.bestStream(coreAudio.streams || [])
      return {
        ...device,
        deviceUID: coreAudio.deviceUID,
        streamIndex: stream?.streamIndex,
        sampleRate: stream?.sampleRate || undefined,
        channels: stream?.channels || undefined,
        bitsPerChannel: stream?.bitsPerChannel || undefined,
        formatID: stream?.formatID || undefined,
        formatFlags: stream?.formatFlags || undefined,
        isLikelyLoopback: this.isLikelyLoopbackName(coreAudio.name || device.name)
      }
    })
  }

  bestStream(streams) {
    return [...streams]
      .filter((stream) => Number(stream.channels) > 0)
      .sort((left, right) => {
        const channelDiff = Number(right.channels || 0) - Number(left.channels || 0)
        if (channelDiff !== 0) return channelDiff
        return Number(right.sampleRate || 0) - Number(left.sampleRate || 0)
      })[0]
  }

  normalizeName(name = '') {
    return String(name).trim().toLowerCase().replace(/\s+/g, ' ')
  }

  isLikelyLoopbackName(name = '') {
    return /\b(loopback|blackhole|soundflower|aggregate|multi-output|multi output|virtual|vb-cable|cable)\b/i.test(
      String(name)
    )
  }
}

export default new DeviceScanner()
