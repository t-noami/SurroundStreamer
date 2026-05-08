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
    throw new Error(`Input Device capture is not implemented on ${this.platform}`)
  }
}

export default UnsupportedAudioBackend
