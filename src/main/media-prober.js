import { spawn } from 'child_process'
import { getFfmpegPath } from './ffmpeg-path'

const layoutChannels = {
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

class MediaProber {
  async probeAudio(path) {
    return await new Promise((resolve, reject) => {
      const ffmpeg = spawn(getFfmpegPath(), ['-hide_banner', '-i', path])
      let output = ''

      ffmpeg.stderr.on('data', (data) => {
        output += data.toString()
      })

      ffmpeg.on('error', reject)
      ffmpeg.on('close', () => {
        const info = this.parseAudioInfo(output)
        if (!info) {
          reject(new Error('No audio stream found'))
          return
        }
        resolve(info)
      })
    })
  }

  parseAudioInfo(output) {
    const line = output
      .split(/\r?\n/)
      .find((item) => item.includes('Audio:') && item.includes(' Hz'))
    if (!line) return null

    const sampleRateMatch = line.match(/,\s*(\d+)\s*Hz,/)
    const layoutMatch = line.match(/,\s*\d+\s*Hz,\s*([^,]+),/)
    const layout = layoutMatch?.[1]?.trim()

    return {
      sampleRate: sampleRateMatch ? Number(sampleRateMatch[1]) : undefined,
      channels: this.channelCountForLayout(layout),
      layout
    }
  }

  channelCountForLayout(layout = '') {
    if (layoutChannels[layout]) return layoutChannels[layout]
    const channelMatch = layout.match(/^(\d+)\s+channels?$/)
    if (channelMatch) return Number(channelMatch[1])
    return undefined
  }
}

export default new MediaProber()
