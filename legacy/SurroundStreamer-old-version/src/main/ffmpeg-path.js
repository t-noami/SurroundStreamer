import ffmpegStatic from 'ffmpeg-static'
import { is } from '@electron-toolkit/utils'

export function getFfmpegPath() {
  if (!ffmpegStatic) {
    throw new Error('FFmpeg binary is not available for this platform')
  }

  // When packaged, we need to point to the unpacked version of the binary
  // because executables cannot be run directly from within an ASAR archive.
  let path = ffmpegStatic
  if (!is.dev) {
    path = path.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
  }

  return path
}

