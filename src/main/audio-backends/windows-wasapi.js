class WindowsWasapiBackend {
  getCapabilities() {
    return {
      platform: 'win32',
      backendName: 'windows-file-only',
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
    throw new Error('App Audio capture is not implemented on Windows')
  }

  spawnInputDevicePCMStream() {
    throw new Error('Input Device capture is not implemented on Windows')
  }
}

export default new WindowsWasapiBackend()
