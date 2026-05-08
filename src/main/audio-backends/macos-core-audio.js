import coreAudioHelper from './macos/core-audio-helper'
import MacOSDeviceScanner from './macos/device-scanner'

const deviceScanner = new MacOSDeviceScanner(coreAudioHelper)

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
    return await coreAudioHelper.listProcesses()
  }

  async listAppOutputStreams() {
    return await coreAudioHelper.listOutputStreams()
  }

  async listInputStreams() {
    return await coreAudioHelper.listInputStreams()
  }

  spawnAppAudioPCMStream(pid, options = {}) {
    return coreAudioHelper.spawnAppPCMStream(pid, options)
  }

  spawnInputDevicePCMStream(options = {}) {
    return coreAudioHelper.spawnInputDevicePCMStream(options)
  }
}

export default new MacOSCoreAudioBackend()
