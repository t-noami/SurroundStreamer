import { spawn } from 'child_process'
import { getFfmpegPath } from './ffmpeg-path'

class DeviceScanner {
  async listAudioDevices() {
    return new Promise((resolve) => {
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
}

export default new DeviceScanner()
