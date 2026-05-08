import macosCoreAudioBackend from './macos-core-audio'
import UnsupportedAudioBackend from './unsupported'
import windowsDshowBackend from './windows-dshow'

function selectAudioBackend() {
  if (process.platform === 'darwin') {
    return macosCoreAudioBackend
  }

  if (process.platform === 'win32') {
    return windowsDshowBackend
  }

  return new UnsupportedAudioBackend(process.platform)
}

export default selectAudioBackend()
