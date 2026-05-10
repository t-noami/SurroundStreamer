class UnsupportedAudioBackend {
  constructor(platform = process.platform) {
    this.platform = platform
  }

  getCapabilities() {
    return {
      platform: this.platform,
      backendName: 'unsupported',
      appAudioCapture: false,
      appAudioPerProcess: false,
      appAudioSurroundPreserve: false,
      inputDeviceCapture: false,
      inputDeviceMonitor: false,
      nativeInputDeviceMonitor: false,
      fileSource: true,
      monitorPlayback: true,
      monitorDeviceEnumeration: false,
      outputLoopbackCapture: false
    }
  }

  async listInputDevices() {
    return []
  }

  async listAppProcesses() {
    return { processes: [] }
  }

  async listAppOutputStreams() {
    return { devices: [] }
  }

  async listInputStreams() {
    return { devices: [] }
  }

  spawnAppAudioPCMStream() {
    throw new Error(`App Audio capture is not implemented on ${this.platform}`)
  }

  spawnInputDevicePCMStream() {
    throw new Error(`Audio Input capture is not implemented on ${this.platform}`)
  }

  spawnNativeInputDeviceMonitor() {
    throw new Error(`Native Audio Input monitor is not implemented on ${this.platform}`)
  }
}

export default UnsupportedAudioBackend
