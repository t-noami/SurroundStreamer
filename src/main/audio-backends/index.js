import macosCoreAudioBackend from './macos-core-audio'
import UnsupportedAudioBackend from './unsupported'

function selectAudioBackend() {
  if (process.platform === 'darwin') {
    return macosCoreAudioBackend
  }

  return new UnsupportedAudioBackend(process.platform)
}

export default selectAudioBackend()
