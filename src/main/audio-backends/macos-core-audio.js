import appAudioHelper from '../app-audio-helper'
import deviceScanner from '../device-scanner'

class MacOSCoreAudioBackend {
  getCapabilities() {
    return {
      platform: process.platform,
      backendName: 'macos-core-audio',
      appAudioCapture: true,
      appAudioPerProcess: true,
      appAudioSurroundPreserve: true,
      inputDeviceCapture: true,
      inputDeviceMonitor: false,
      fileSource: true,
      monitorPlayback: true,
      monitorDeviceEnumeration: true,
      outputLoopbackCapture: false
    }
  }

  async listInputDevices() {
    return await deviceScanner.listAudioDevices()
  }

  async listAppProcesses() {
    return await appAudioHelper.listProcesses()
  }

  async listAppOutputStreams() {
    return await appAudioHelper.listOutputStreams()
  }

  async listInputStreams() {
    return await appAudioHelper.listInputStreams()
  }

  spawnAppAudioPCMStream(pid, options = {}) {
    return appAudioHelper.spawnPCMStream(pid, options)
  }

  spawnInputDevicePCMStream(options = {}) {
    return appAudioHelper.spawnInputDevicePCMStream(options)
  }
}

export default new MacOSCoreAudioBackend()
