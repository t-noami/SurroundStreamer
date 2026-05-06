import { spawn } from 'child_process'
import { getFfmpegPath } from './ffmpeg-path'

class MonitorScanner {
  async listOutputDevices() {
    return new Promise((resolve) => {
      const ffmpeg = spawn(getFfmpegPath(), [
        '-hide_banner',
        '-f',
        'lavfi',
        '-i',
        'anullsrc',
        '-f',
        'audiotoolbox',
        '-list_devices',
        'true',
        '-'
      ])

      let output = ''
      ffmpeg.stderr.on('data', (data) => {
        output += data.toString()
      })

      ffmpeg.on('close', () => {
        resolve(this.parseDevices(output))
      })

      ffmpeg.on('error', () => {
        resolve([])
      })
    })
  }

  parseDevices(output) {
    const devices = []
    const seen = new Set()

    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/\[(\d+)]\s+([^\r\n]+)/)
      if (!match) continue

      const index = Number(match[1])
      const name = match[2].trim()
      const key = `${index}:${name}`
      if (!name || seen.has(key)) continue

      seen.add(key)
      devices.push({ index, name })
    }

    return devices
  }
}

export default new MonitorScanner()
