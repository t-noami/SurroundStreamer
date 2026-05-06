import ffmpegStatic from 'ffmpeg-static'

export function getFfmpegPath() {
  if (!ffmpegStatic) {
    throw new Error('FFmpeg binary is not available for this platform')
  }

  return ffmpegStatic.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
}
