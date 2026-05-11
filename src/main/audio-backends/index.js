import macosCoreAudioBackend from './macos-core-audio'
import UnsupportedAudioBackend from './unsupported'
import windowsWasapiBackend from './windows-wasapi'

function selectAudioBackend() {
  if (process.platform === 'darwin') {
    return macosCoreAudioBackend
  }

  if (process.platform === 'win32') {
    return windowsWasapiBackend
  }

  return new UnsupportedAudioBackend(process.platform)
}

export default selectAudioBackend()
