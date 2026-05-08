import { WebAudioMonitor } from './monitor-audio'
const statusBadge = document.getElementById('status-badge')
const btnStart = document.getElementById('btn-start')
const btnStop = document.getElementById('btn-stop')
const logOutput = document.getElementById('log-output')
const streamTimer = document.getElementById('stream-timer')

const tabFile = document.getElementById('tab-file')
const tabDevice = document.getElementById('tab-device')
const tabAppAudio = document.getElementById('tab-app-audio')
const fileInputSection = document.getElementById('file-input-section')
const deviceInputSection = document.getElementById('device-input-section')
const appAudioInputSection = document.getElementById('app-audio-input-section')

const deviceList = document.getElementById('device-list')
const btnRefreshDevices = document.getElementById('btn-refresh-devices')
const btnBrowse = document.getElementById('btn-browse')
const filePathInput = document.getElementById('file-path')
const loopFileInput = document.getElementById('loop-file')
const appAudioList = document.getElementById('app-audio-list')
const appAudioOutputStream = document.getElementById('app-audio-output-stream')
const btnRefreshAppAudio = document.getElementById('btn-refresh-app-audio')

const bitrateSelect = document.getElementById('bitrate-select')
const bitrateActualValue = document.getElementById('bitrate-actual-value')
const sampleRateSelect = document.getElementById('sample-rate-select')
const channelTemplateSelect = document.getElementById('channel-template-select')
const channelSelector = document.getElementById('channel-selector')
const btnSelectDefaultChannels = document.getElementById('btn-select-default-channels')
const peakMeterList = document.getElementById('peak-meter-list')
const meterState = document.getElementById('meter-state')
const monitorPeakMeterList = document.getElementById('monitor-peak-meter-list')
const monitorMeterState = document.getElementById('monitor-meter-state')
const monitorEnabled = document.getElementById('monitor-enabled')
const monitorDeviceList = document.getElementById('monitor-device-list')
const monitorMode = document.getElementById('monitor-mode')
const monitorPairGroup = document.getElementById('monitor-pair-group')
const monitorSourcePair = document.getElementById('monitor-source-pair')
const monitorLatency = document.getElementById('monitor-latency')
const monitorVolume = document.getElementById('monitor-volume')
const monitorVolumeValue = document.getElementById('monitor-volume-value')
const btnRefreshMonitorDevices = document.getElementById('btn-refresh-monitor-devices')
const icecastHostInput = document.getElementById('icecast-host')
const icecastPortInput = document.getElementById('icecast-port')
const mountPointInput = document.getElementById('mount-point')
const sourcePasswordInput = document.getElementById('source-password')
const icecastSettingsFields = [
  icecastHostInput,
  icecastPortInput,
  mountPointInput,
  sourcePasswordInput
]
const encodingSettingsFields = [
  bitrateSelect,
  sampleRateSelect,
  channelTemplateSelect,
  btnSelectDefaultChannels
]

const channelNames = ['L', 'R', 'C', 'LFE', 'LS', 'RS', 'LSR', 'RSR']
const FILE_MAX_CHANNELS = 8
const ICECAST_SETTINGS_STORAGE_KEY = 'surroundStreamer.icecastSettings.v1'
const defaultIcecastSettings = {
  host: '',
  port: '8000',
  mountPoint: '/stream',
  sourcePassword: ''
}
const channelTemplates = [
  {
    id: 'mono',
    label: 'Mono',
    channels: ['FC'],
    displayLabels: ['C'],
    layout: 'mono'
  },
  {
    id: 'stereo',
    label: 'Stereo',
    channels: ['FL', 'FR'],
    displayLabels: ['L', 'R'],
    layout: 'stereo'
  },
  {
    id: 'stereo-c',
    label: 'Stereo + C',
    channels: ['FL', 'FR', 'FC'],
    displayLabels: ['L', 'R', 'C'],
    layout: '3.0'
  },
  {
    id: '5.1',
    label: '5.1',
    channels: ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'],
    displayLabels: ['L', 'R', 'C', 'LFE', 'LS', 'RS'],
    layout: '5.1'
  },
  {
    id: '7.1',
    label: '7.1',
    channels: ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'],
    displayLabels: ['L', 'R', 'C', 'LFE', 'LS', 'RS', 'LSR', 'RSR'],
    layout: '7.1'
  }
]

let startTime = null
let timerInterval = null
let currentInputType = 'app-audio'
let activeMeterChannels = 6
let activeMonitorMeterChannels = 2
let inputDevices = []
let fileInputInfo = null
let isStreaming = false
let currentMonitorFormat = null
let monitorSettingsPromise = Promise.resolve()
let previewMonitorKey = ''
let pendingPreviewStart = false
let lastMonitorPeakUpdateAt = 0
let audioBackendCapabilities = {
  platform: 'darwin',
  backendName: 'macos-core-audio',
  appAudioCapture: true,
  inputDeviceCapture: true,
  inputDeviceMonitor: false,
  fileSource: true,
  monitorPlayback: true
}
const webAudioMonitor = new WebAudioMonitor(addLog)

function addLog(message, type = 'system', options = {}) {
  const timestamp = Date.now()
  if (logOutput) {
    const entry = document.createElement('div')
    entry.className = `log-entry ${type}`
    entry.textContent = `[${new Date(timestamp).toLocaleTimeString()}] ${message}`
    logOutput.appendChild(entry)
    logOutput.scrollTop = logOutput.scrollHeight
  }
  if (options.record !== false) {
    window.api.addLogEntry({ timestamp, message, type }).catch(() => {})
  }
}

function updateTimer() {
  if (!startTime) return
  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const hours = Math.floor(elapsed / 3600)
    .toString()
    .padStart(2, '0')
  const mins = Math.floor((elapsed % 3600) / 60)
    .toString()
    .padStart(2, '0')
  const secs = (elapsed % 60).toString().padStart(2, '0')
  streamTimer.textContent = `${hours}:${mins}:${secs}`
}

function setStreamingState(nextIsStreaming) {
  isStreaming = nextIsStreaming
  statusBadge.textContent = nextIsStreaming ? 'LIVE' : 'IDLE'
  statusBadge.classList.toggle('live', nextIsStreaming)
  statusBadge.classList.toggle('idle', !nextIsStreaming)
  btnStart.classList.toggle('hidden', nextIsStreaming)
  btnStop.classList.toggle('hidden', !nextIsStreaming)
  meterState.textContent = nextIsStreaming ? 'LIVE' : 'IDLE'
  setInputSourceLocked(nextIsStreaming)
  setIcecastSettingsLocked(nextIsStreaming)
  setEncodingSettingsLocked(nextIsStreaming)

  if (nextIsStreaming && !startTime) {
    startTime = Date.now()
    timerInterval = setInterval(updateTimer, 1000)
  }

  if (!nextIsStreaming) {
    clearInterval(timerInterval)
    timerInterval = null
    startTime = null
    streamTimer.textContent = '00:00:00'
    resetPeakMeters()
  }
}

function setInputSourceLocked(isLocked) {
  btnBrowse.disabled = isLocked || !audioBackendCapabilities.fileSource
  filePathInput.disabled = isLocked || !audioBackendCapabilities.fileSource
  loopFileInput.disabled = isLocked || !audioBackendCapabilities.fileSource
  deviceList.disabled = isLocked || !audioBackendCapabilities.inputDeviceCapture
  btnRefreshDevices.disabled = isLocked || !audioBackendCapabilities.inputDeviceCapture
  appAudioList.disabled = isLocked || !audioBackendCapabilities.appAudioCapture
  appAudioOutputStream.disabled = isLocked || !audioBackendCapabilities.appAudioCapture
  btnRefreshAppAudio.disabled = isLocked || !audioBackendCapabilities.appAudioCapture
  tabFile.disabled = isLocked || !audioBackendCapabilities.fileSource
  tabDevice.disabled = isLocked || !audioBackendCapabilities.inputDeviceCapture
  tabAppAudio.disabled = isLocked || !audioBackendCapabilities.appAudioCapture
  document.querySelector('.input-panel')?.classList.toggle('disabled-panel', isLocked)
}

function isSourceSupported(inputType) {
  if (inputType === 'file') return audioBackendCapabilities.fileSource !== false
  if (inputType === 'device') return !!audioBackendCapabilities.inputDeviceCapture
  if (inputType === 'app-audio') return !!audioBackendCapabilities.appAudioCapture
  return false
}

function applyAudioBackendCapabilities() {
  setInputSourceLocked(isStreaming)
  tabFile.title = audioBackendCapabilities.fileSource ? '' : 'File source is not available'
  tabDevice.title = audioBackendCapabilities.inputDeviceCapture
    ? ''
    : 'Input Device capture is not available on this platform'
  tabAppAudio.title = audioBackendCapabilities.appAudioCapture
    ? ''
    : 'App Audio capture is not available on this platform'

  if (!isSourceSupported(currentInputType)) {
    const fallback = isSourceSupported('file')
      ? 'file'
      : isSourceSupported('app-audio')
        ? 'app-audio'
        : 'device'
    showInputSection(fallback)
  }

  updateMonitorAvailability()
}

async function loadAudioBackendCapabilities() {
  if (!window.api.getAudioBackendCapabilities) {
    applyAudioBackendCapabilities()
    return
  }

  try {
    audioBackendCapabilities = {
      ...audioBackendCapabilities,
      ...(await window.api.getAudioBackendCapabilities())
    }
    addLog(
      `Audio backend: ${audioBackendCapabilities.backendName || 'unknown'} (${audioBackendCapabilities.platform || 'unknown'}).`,
      'system'
    )
  } catch (err) {
    addLog(`Could not read audio backend capabilities: ${err.message}`, 'error')
  }

  applyAudioBackendCapabilities()
}

function setIcecastSettingsLocked(isLocked) {
  icecastSettingsFields.forEach((field) => {
    if (field) field.disabled = isLocked
  })
  document.querySelector('.config-panel')?.classList.toggle('disabled-panel', isLocked)
}

function setEncodingSettingsLocked(isLocked) {
  encodingSettingsFields.forEach((field) => {
    if (field) field.disabled = isLocked
  })
  channelSelector.querySelectorAll('input').forEach((input) => {
    input.disabled = isLocked
  })
  document.querySelector('.encode-panel')?.classList.toggle('disabled-panel', isLocked)
}

function normalizeMountPoint(mountPoint) {
  const value = String(mountPoint || '').trim()
  if (!value) return defaultIcecastSettings.mountPoint
  return value.startsWith('/') ? value : `/${value}`
}

function currentIcecastSettings() {
  return {
    host: icecastHostInput.value.trim(),
    port: String(icecastPortInput.value || '').trim(),
    mountPoint: normalizeMountPoint(mountPointInput.value),
    sourcePassword: sourcePasswordInput.value
  }
}

function applyIcecastSettings(settings) {
  const merged = {
    ...defaultIcecastSettings,
    ...(settings || {})
  }

  icecastHostInput.value = merged.host || defaultIcecastSettings.host
  icecastPortInput.value = merged.port || defaultIcecastSettings.port
  mountPointInput.value = normalizeMountPoint(merged.mountPoint)
  sourcePasswordInput.value =
    merged.sourcePassword === undefined
      ? defaultIcecastSettings.sourcePassword
      : merged.sourcePassword
}

function loadIcecastSettings() {
  try {
    const raw = localStorage.getItem(ICECAST_SETTINGS_STORAGE_KEY)
    if (!raw) {
      applyIcecastSettings(defaultIcecastSettings)
      return
    }
    applyIcecastSettings(JSON.parse(raw))
  } catch {
    applyIcecastSettings(defaultIcecastSettings)
  }
}

function saveIcecastSettings() {
  const settings = currentIcecastSettings()
  mountPointInput.value = settings.mountPoint
  try {
    localStorage.setItem(ICECAST_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch (err) {
    addLog(`Could not save Icecast settings: ${err.message}`, 'error')
  }
}

function showInputSection(inputType) {
  if (!isSourceSupported(inputType)) {
    addLog(`Input source "${inputType}" is not supported by the current audio backend.`, 'error')
    return
  }

  const previousInputType = currentInputType
  currentInputType = inputType

  if (previousInputType !== inputType && !isStreaming) {
    void forceStopPreviewMonitor()
  }

  tabFile.classList.toggle('active', inputType === 'file')
  tabDevice.classList.toggle('active', inputType === 'device')
  tabAppAudio.classList.toggle('active', inputType === 'app-audio')
  fileInputSection.classList.toggle('hidden', inputType !== 'file')
  deviceInputSection.classList.toggle('hidden', inputType !== 'device')
  appAudioInputSection.classList.toggle('hidden', inputType !== 'app-audio')
  updateChannelControls()
  updateMonitorAvailability()
  applyLowLatencyMonitorDefault()
  if (!(inputType === 'app-audio' && previousInputType !== inputType)) {
    applyMonitorSettings('input')
  }
}

async function refreshDevices() {
  if (!audioBackendCapabilities.inputDeviceCapture) {
    inputDevices = []
    deviceList.innerHTML =
      '<option value="">Input Device is not available on this platform</option>'
    addLog('Input Device capture is not available with the current audio backend.', 'system')
    return
  }

  await ensureMicrophoneAccess('device scan')
  addLog('Scanning audio devices...', 'system')
  try {
    const devices = await window.api.listDevices()
    inputDevices = devices
    deviceList.innerHTML = ''
    if (devices.length === 0) {
      deviceList.innerHTML = '<option value="">No audio devices found</option>'
    } else {
      devices.forEach((dev) => {
        const opt = document.createElement('option')
        opt.value = dev.index
        opt.textContent = formatDeviceOption(dev)
        deviceList.appendChild(opt)
      })
    }
    addLog(`Found ${devices.length} devices.`, 'system')
    syncInputSettings(true)
  } catch (err) {
    addLog(`Error listing devices: ${err.message}`, 'error')
  }
}

async function ensureMicrophoneAccess(reason = 'device input') {
  if (!window.api.ensureMicrophoneAccess) {
    return true
  }

  const result = await window.api.ensureMicrophoneAccess()
  if (result?.granted) {
    return true
  }

  addLog(
    `Microphone access is ${result?.status || 'unavailable'}; ${reason} cannot capture input audio.`,
    'error'
  )
  if (result?.status === 'denied' || result?.status === 'restricted') {
    await window.api.openMicrophoneSettings?.()
    addLog('Opened macOS Microphone privacy settings for SurroundStreamer.', 'system')
  }
  return false
}

function formatDeviceOption(device) {
  const details = []
  if (device.channels) details.push(`${device.channels}ch`)
  if (device.sampleRate) details.push(formatSampleRate(device.sampleRate))
  if (device.isLikelyLoopback) details.push('loopback/virtual')
  return details.length > 0
    ? `[${device.index}] ${device.name} (${details.join(', ')})`
    : `[${device.index}] ${device.name}`
}

function isWindowsOutputLoopbackMode() {
  return !!audioBackendCapabilities.outputLoopbackCapture && !audioBackendCapabilities.appAudioPerProcess
}

function warnIfLoopbackInputDevice(device) {
  if (!device?.isLikelyLoopback) return
  addLog(
    `Selected input device "${device.name}" looks like a loopback/virtual device, so it may include system output audio.`,
    'error'
  )
}

async function refreshMonitorDevices(requestOutputSelection = false) {
  addLog('Scanning monitor output devices...', 'system')
  try {
    if (!navigator.mediaDevices?.enumerateDevices) {
      monitorDeviceList.innerHTML = '<option value="">System Default</option>'
      addLog('Monitor device enumeration is not available. Using system default output.', 'system')
      return
    }

    let selectedOutput = null
    if (requestOutputSelection && navigator.mediaDevices.selectAudioOutput) {
      try {
        selectedOutput = await navigator.mediaDevices.selectAudioOutput()
      } catch {
        selectedOutput = null
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices()
    const outputs = devices.filter((device) => device.kind === 'audiooutput')
    monitorDeviceList.innerHTML = ''

    const defaultOpt = document.createElement('option')
    defaultOpt.value = ''
    defaultOpt.textContent = 'System Default'
    monitorDeviceList.appendChild(defaultOpt)

    const seen = new Set([''])
    outputs.forEach((device, index) => {
      if (seen.has(device.deviceId)) return
      seen.add(device.deviceId)
      const opt = document.createElement('option')
      opt.value = device.deviceId
      opt.textContent = device.label || `Output Device ${index + 1}`
      monitorDeviceList.appendChild(opt)
    })

    if (selectedOutput?.deviceId) {
      monitorDeviceList.value = selectedOutput.deviceId
    }

    addLog(`Found ${outputs.length} monitor output devices.`, 'system')
    if (isStreaming && monitorEnabled.checked) {
      applyMonitorSettings('device')
    }
  } catch (err) {
    monitorDeviceList.innerHTML = '<option value="">System Default</option>'
    addLog(`Error listing monitor devices: ${err.message}`, 'error')
  }
}

async function refreshAppAudioProcesses() {
  if (!audioBackendCapabilities.appAudioCapture) {
    appAudioList.innerHTML = '<option value="">App Audio is not available on this platform</option>'
    addLog('App Audio capture is not available with the current audio backend.', 'system')
    return
  }

  const isLoopbackMode = isWindowsOutputLoopbackMode()
  addLog(
    isLoopbackMode ? 'Scanning output loopback capture sources...' : 'Scanning app audio processes...',
    'system'
  )
  try {
    const previousValue = appAudioList.value
    const result = await window.api.listAppAudioProcesses()
    const processes = result.processes || []
    appAudioList.innerHTML = ''
    if (processes.length === 0) {
      appAudioList.innerHTML = `<option value="">${isLoopbackMode ? 'No output loopback sources found' : 'No app audio processes found'}</option>`
    } else {
      processes.forEach((process) => {
        const opt = document.createElement('option')
        opt.value = process.pid
        opt.textContent = isLoopbackMode
          ? process.name
          : `${process.isRunningOutput ? '* ' : ''}${process.name} [${process.pid}]`
        appAudioList.appendChild(opt)
      })
      if (processes.some((process) => String(process.pid) === String(previousValue))) {
        appAudioList.value = previousValue
      }
    }
    addLog(
      `Found ${processes.length} ${isLoopbackMode ? 'output loopback sources' : 'app audio processes'}.`,
      'system'
    )
  } catch (err) {
    addLog(
      `Error listing ${isLoopbackMode ? 'output loopback sources' : 'app audio processes'}: ${err.message}`,
      'error'
    )
  }
}

async function refreshAppAudioOutputStreams() {
  if (!audioBackendCapabilities.appAudioCapture) {
    appAudioOutputStream.innerHTML =
      '<option value="">App output capture is not available on this platform</option>'
    return
  }

  const isLoopbackMode = isWindowsOutputLoopbackMode()
  addLog(
    isLoopbackMode
      ? 'Scanning DirectShow loopback devices...'
      : 'Scanning app output capture sources...',
    'system'
  )
  try {
    const previousValue = appAudioOutputStream.value
    const result = await window.api.listAppAudioOutputStreams()
    const devices = result.devices || []
    appAudioOutputStream.innerHTML = ''

    let streamCount = 0
    devices.forEach((device) => {
      ;(device.streams || []).forEach((stream) => {
        streamCount += 1
        const opt = document.createElement('option')
        const payload = {
          deviceUID: device.deviceUID,
          deviceName: device.name,
          streamIndex: stream.streamIndex,
          sampleRate: stream.sampleRate || 48000,
          channels: stream.channels || 2,
          bitsPerChannel: stream.bitsPerChannel || 32
        }
        opt.value = JSON.stringify(payload)
        opt.textContent = isLoopbackMode
          ? `${device.name} loopback: ${payload.channels}ch @ ${formatSampleRate(payload.sampleRate)}`
          : `${device.name} app output / Stream ${stream.streamIndex}: ${payload.channels}ch @ ${formatSampleRate(payload.sampleRate)}`
        appAudioOutputStream.appendChild(opt)
      })
    })

    if (streamCount === 0) {
      appAudioOutputStream.innerHTML = `<option value="">${isLoopbackMode ? 'No DirectShow loopback devices found' : 'No app output capture sources found'}</option>`
    } else if (
      Array.from(appAudioOutputStream.options).some((option) => option.value === previousValue)
    ) {
      appAudioOutputStream.value = previousValue
    }

    addLog(
      `Found ${streamCount} ${isLoopbackMode ? 'DirectShow loopback devices' : 'app output capture sources'}.`,
      'system'
    )
    syncInputSettings(true)
  } catch (err) {
    addLog(
      `Error listing ${isLoopbackMode ? 'DirectShow loopback devices' : 'app output capture sources'}: ${err.message}`,
      'error'
    )
  }
}

function selectedAppAudioStream() {
  if (!appAudioOutputStream.value) {
    return null
  }

  try {
    return JSON.parse(appAudioOutputStream.value)
  } catch {
    return null
  }
}

function selectedAppAudioMonitorConfig() {
  const pid = appAudioList.value
  const stream = selectedAppAudioStream()
  const lowLatencyMonitor = shouldUseLowLatencyMonitor('app-audio', monitorMode.value)

  return {
    inputType: 'app-audio',
    inputPath: pid,
    appAudioPid: pid ? Number(pid) : undefined,
    appAudioMode: 'preserve',
    appAudioDeviceUID: stream?.deviceUID,
    appAudioStreamIndex: stream?.streamIndex,
    appAudioSampleRate: stream?.sampleRate,
    appAudioChannels: stream?.channels || 2,
    monitorMode: monitorMode.value,
    monitorPairStart: Number(monitorSourcePair.value || 0),
    monitorLatencyMs: effectiveMonitorLatencyMs('app-audio', monitorMode.value),
    monitorLowLatency: lowLatencyMonitor,
    monitorVolume: monitorVolumePercent()
  }
}

function selectedFileMonitorConfig() {
  const selectedChannels = selectedChannelIndexes()
  const inputInfo = selectedInputInfo()
  return {
    inputType: 'file',
    inputPath: filePathInput.value,
    selectedChannels,
    streamChannelLayout: selectedStreamLayout(),
    sampleRate: inputInfo.sampleRate || Number(sampleRateSelect.value),
    monitorMode: monitorMode.value,
    monitorPairStart: Number(monitorSourcePair.value || 0),
    monitorLatencyMs: Number(monitorLatency.value || 80),
    monitorLowLatency: false,
    monitorVolume: monitorVolumePercent(),
    loopFile: loopFileInput.checked
  }
}

function selectedInputDeviceMonitorConfig() {
  const inputInfo = selectedInputInfo()
  return {
    inputType: 'device',
    inputPath: selectedInputDevicePath(),
    inputChannels: inputInfo.channels,
    inputSampleRate: inputInfo.sampleRate,
    inputDeviceUID: selectedInputDevice()?.deviceUID,
    inputStreamIndex: selectedInputDevice()?.streamIndex,
    sampleRate: inputInfo.sampleRate || Number(sampleRateSelect.value),
    monitorMode: monitorMode.value,
    monitorPairStart: Number(monitorSourcePair.value || 0),
    monitorLatencyMs: Number(monitorLatency.value || 80),
    monitorLowLatency: false,
    monitorVolume: monitorVolumePercent()
  }
}

function selectedPreviewMonitorConfig() {
  if (currentInputType === 'file') {
    return selectedFileMonitorConfig()
  }
  if (currentInputType === 'app-audio') {
    return selectedAppAudioMonitorConfig()
  }
  if (currentInputType === 'device') {
    return selectedInputDeviceMonitorConfig()
  }
  return null
}

function supportsPreviewMonitor() {
  if (!audioBackendCapabilities.monitorPlayback) return false
  if (currentInputType === 'file') return audioBackendCapabilities.fileSource !== false
  if (currentInputType === 'app-audio') return !!audioBackendCapabilities.appAudioCapture
  if (currentInputType === 'device') return !!audioBackendCapabilities.inputDeviceMonitor
  return false
}

function isMonitorAvailable() {
  if (!audioBackendCapabilities.monitorPlayback) return false
  if (currentInputType === 'device') return !!audioBackendCapabilities.inputDeviceMonitor
  return isSourceSupported(currentInputType)
}

function updateMonitorAvailability() {
  const available = isMonitorAvailable()
  monitorEnabled.disabled = !available
  monitorDeviceList.disabled = !available
  monitorMode.disabled = !available
  monitorSourcePair.disabled = !available
  monitorLatency.disabled = !available
  monitorVolume.disabled = !available
  btnRefreshMonitorDevices.disabled = !available
  document.querySelector('.monitor-panel')?.classList.toggle('disabled-panel', !available)

  if (!available) {
    monitorEnabled.checked = false
    monitorMeterState.textContent = 'IDLE'
    resetMonitorPeakMeters()
  }
}

function getAvailableChannelCount() {
  return selectedInputInfo().channels || 2
}

function defaultChannelCount() {
  if (currentInputType === 'device') {
    return Math.min(getAvailableChannelCount(), 2)
  }
  return Math.min(getAvailableChannelCount(), 6)
}

function selectedInputInfo() {
  if (currentInputType === 'app-audio') {
    const stream = selectedAppAudioStream()
    return {
      channels: stream?.channels || 2,
      sampleRate: stream?.sampleRate || 48000
    }
  }

  if (currentInputType === 'device') {
    const device = selectedInputDevice()
    return {
      channels: device?.channels || 2,
      sampleRate: device?.sampleRate || 48000
    }
  }

  return {
    channels: FILE_MAX_CHANNELS,
    sampleRate: fileInputInfo?.sampleRate || 48000
  }
}

function selectedInputDevice() {
  return inputDevices.find((item) => String(item.index) === String(deviceList.value)) || null
}

function selectedInputDevicePath() {
  return deviceList.value ? `none:${deviceList.value}` : ''
}

function syncInputSettings(useDefaults = false) {
  syncSampleRateToInput()
  updateChannelControls(useDefaults)
}

function syncSampleRateToInput() {
  const sampleRate = selectedInputInfo().sampleRate
  const normalized = streamOutputSampleRate(sampleRate)
  sampleRateSelect.disabled = !!normalized
  if (normalized) {
    sampleRateSelect.value = String(normalized)
  }
}

function renderChannelTemplates(selectedTemplateId = channelTemplateSelect.value) {
  const templates = compatibleChannelTemplates(getAvailableChannelCount())
  const previous =
    selectedTemplateId || defaultChannelTemplate(templates)?.id || templates[0]?.id || ''
  channelTemplateSelect.innerHTML = ''

  templates.forEach((template) => {
    const opt = document.createElement('option')
    opt.value = template.id
    opt.textContent = template.label
    channelTemplateSelect.appendChild(opt)
  })

  if (templates.some((template) => template.id === previous)) {
    channelTemplateSelect.value = previous
  } else if (templates.length > 0) {
    channelTemplateSelect.value =
      defaultChannelTemplate(templates)?.id || templates[templates.length - 1].id
  }
}

function compatibleChannelTemplates(maxChannels) {
  return channelTemplates.filter((template) => template.channels.length <= maxChannels)
}

function selectedChannelTemplate() {
  const selectedChannels = selectedChannelIndexes().length
  return (
    channelTemplates.find((template) => template.id === channelTemplateSelect.value) ||
    channelTemplates.find((template) => template.channels.length === selectedChannels)
  )
}

function selectedStreamLayout() {
  const selectedChannels = selectedChannelIndexes().length
  const template = selectedChannelTemplate()
  return template?.channels.length === selectedChannels ? template.layout : null
}

function selectedTemplateChannelLabels(channels) {
  const template = selectedChannelTemplate()
  return Array.from({ length: channels }, (_value, index) => {
    return template?.channels[index] || channelNames[index] || `CH${index + 1}`
  })
}

function defaultChannelTemplate(templates) {
  if (templates.length === 0) return null
  if (getAvailableChannelCount() >= 6) {
    return (
      templates.find((template) => template.id === '5.1') ||
      templates.find((template) => template.id === 'stereo') ||
      templates[templates.length - 1]
    )
  }
  if (getAvailableChannelCount() >= 2) {
    return (
      templates.find((template) => template.id === 'stereo') ||
      templates.find((template) => template.id === 'mono') ||
      templates[0]
    )
  }
  return templates.find((template) => template.id === 'mono') || templates[0]
}

function templateSourceIndexes(template) {
  if (!template) return []
  return Array.from({ length: template.channels.length }, (_value, index) => index)
}

function streamChannelName(index, template) {
  if (template?.displayLabels?.[index]) {
    return template.displayLabels[index]
  }
  if (template?.channels[index]) {
    return template.channels[index]
  }
  return channelNames[index] || `CH${index + 1}`
}

function updateChannelControls(useDefaults = false, templateId = null) {
  const maxChannels = getAvailableChannelCount()
  const compatibleTemplates = compatibleChannelTemplates(maxChannels)
  const selectedTemplateId =
    templateId ||
    (useDefaults ? defaultChannelTemplate(compatibleTemplates)?.id : channelTemplateSelect.value)
  const template = compatibleTemplates.find((item) => item.id === selectedTemplateId)
  const defaults = template?.channels.length || defaultChannelCount()
  const defaultSelection = new Set(templateSourceIndexes(template))
  const previous = new Set(selectedChannelIndexes())

  renderChannelTemplates(template?.id || selectedTemplateId)
  channelSelector.innerHTML = ''
  for (let index = 0; index < Math.min(maxChannels, channelNames.length); index += 1) {
    const label = document.createElement('label')
    label.className = 'channel-toggle'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = String(index)
    input.checked = useDefaults
      ? defaultSelection.size > 0
        ? defaultSelection.has(index)
        : index < defaults
      : previous.size === 0
        ? defaultSelection.size > 0
          ? defaultSelection.has(index)
          : index < defaults
        : previous.has(index)
    input.addEventListener('change', () => {
      renderPeakMeters(selectedChannelIndexes().length || 1)
      updateMonitorRoutingControls()
      updateBitrateActualLabel()
      applyMonitorSettings('channels')
    })

    const text = document.createElement('span')
    text.textContent = `${index + 1} ${streamChannelName(index, template)}`

    label.appendChild(input)
    label.appendChild(text)
    channelSelector.appendChild(label)
  }

  renderPeakMeters(selectedChannelIndexes().length || defaults)
  updateMonitorRoutingControls()
  updateBitrateActualLabel()
}

function selectedChannelIndexes() {
  return Array.from(channelSelector.querySelectorAll('input:checked')).map((input) =>
    Number(input.value)
  )
}

function renderPeakMeters(channels) {
  activeMeterChannels = Math.max(1, channels)
  peakMeterList.innerHTML = ''

  renderPeakMeterRows(peakMeterList, activeMeterChannels)
}

function renderMonitorPeakMeters(channels) {
  activeMonitorMeterChannels = Math.max(1, channels)
  renderPeakMeterRows(monitorPeakMeterList, activeMonitorMeterChannels)
}

function renderPeakMeterRows(container, channels) {
  container.innerHTML = ''

  for (let index = 0; index < channels; index += 1) {
    const row = document.createElement('div')
    row.className = 'peak-row'
    row.dataset.channel = String(index)

    const label = document.createElement('div')
    label.className = 'peak-label'
    label.textContent = `CH${index + 1}`

    const track = document.createElement('div')
    track.className = 'peak-track'

    const fill = document.createElement('div')
    fill.className = 'peak-fill'
    track.appendChild(fill)

    const value = document.createElement('div')
    value.className = 'peak-value'
    value.textContent = '-inf'

    row.appendChild(label)
    row.appendChild(track)
    row.appendChild(value)
    container.appendChild(row)
  }
}

function resetPeakMeters() {
  resetPeakMeterRows(peakMeterList)
}

function resetMonitorPeakMeters() {
  resetPeakMeterRows(monitorPeakMeterList)
}

function resetPeakMeterRows(container) {
  container.querySelectorAll('.peak-row').forEach((row) => {
    row.querySelector('.peak-fill').style.width = '0%'
    row.querySelector('.peak-value').textContent = '-inf'
  })
}

function updatePeakMeters(payload) {
  const channels = payload.channels || activeMeterChannels
  if (channels !== activeMeterChannels) {
    renderPeakMeters(channels)
  }

  updatePeakMeterRows(peakMeterList, payload.peaks)
}

function updateMonitorPeakMeters(payload) {
  const channels = payload.channels || activeMonitorMeterChannels
  if (channels !== activeMonitorMeterChannels) {
    renderMonitorPeakMeters(channels)
  }

  updatePeakMeterRows(monitorPeakMeterList, payload.peaks)
}

function updatePeakMeterRows(container, peaks = {}) {
  Object.entries(peaks || {}).forEach(([channel, db]) => {
    const row = container.querySelector(`[data-channel="${channel}"]`)
    if (!row) return

    const numericDb = Number(db)
    const clamped = Math.max(-60, Math.min(0, numericDb))
    const percent = ((clamped + 60) / 60) * 100
    const fill = row.querySelector('.peak-fill')
    fill.style.width = `${percent}%`
    fill.classList.toggle('warn', numericDb > -6 && numericDb <= -1)
    fill.classList.toggle('hot', numericDb > -1)
    row.querySelector('.peak-value').textContent =
      numericDb <= -119 ? '-inf' : `${numericDb.toFixed(1)} dB`
  })
}

function calculateMonitorPeaks(chunk, channels) {
  if (!chunk || !channels) return null

  const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
  const samples = new Float32Array(view.buffer, view.byteOffset, Math.floor(view.byteLength / 4))
  const frameCount = Math.floor(samples.length / channels)
  if (frameCount <= 0) return null

  const peaks = {}
  for (let channel = 0; channel < channels; channel += 1) {
    let peak = 0
    for (let frame = 0; frame < frameCount; frame += 1) {
      const sample = Math.abs(samples[frame * channels + channel] || 0)
      if (sample > peak) peak = sample
    }
    peaks[channel] = peak <= 0 ? -120 : 20 * Math.log10(peak)
  }

  return { channels, peaks }
}

function calculateMonitorOutputPeaks(chunk, format) {
  if (!chunk || !format?.channels) return null

  const input = calculateMonitorPeaks(chunk, format.channels)
  if (!input) return null

  const volume = Number.isFinite(Number(format.volume)) ? Number(format.volume) : 1
  const left = monitorOutputPeakAmplitude(input.peaks, 0, format) * volume
  const right = monitorOutputPeakAmplitude(input.peaks, 1, format) * volume

  return {
    channels: 2,
    peaks: {
      0: amplitudeToDb(left),
      1: amplitudeToDb(right)
    }
  }
}

function monitorOutputPeakAmplitude(inputPeaks, outputChannel, format) {
  const mode = format.mode || monitorMode.value
  const channels = format.channels || 2

  if (mode === 'stereo-pair' || mode === 'stereo') {
    const sourceIndex = Math.min((format.pairStart || 0) + outputChannel, channels - 1)
    return dbToAmplitude(inputPeaks[sourceIndex])
  }

  if (mode === 'downmix') {
    let sum = 0
    for (let channel = 0; channel < channels; channel += 1) {
      const gains = downmixGains(channel, channels)
      sum += dbToAmplitude(inputPeaks[channel]) * (outputChannel === 0 ? gains.left : gains.right)
    }
    return sum * 0.707
  }

  let sum = 0
  for (let channel = 0; channel < channels; channel += 1) {
    sum +=
      dbToAmplitude(inputPeaks[channel]) * hrtfMonitorGain(format.channelLabels?.[channel], channel)
  }
  return sum * 0.35
}

function downmixGains(channel, totalChannels) {
  if (totalChannels === 1) {
    return { left: 1, right: 1 }
  }

  const minus3db = 0.707
  const matrix = [
    { left: 1, right: 0 },
    { left: 0, right: 1 },
    { left: minus3db, right: minus3db },
    { left: 0, right: 0 },
    { left: minus3db, right: 0 },
    { left: 0, right: minus3db },
    { left: minus3db, right: 0 },
    { left: 0, right: minus3db }
  ]

  return (
    matrix[channel] || {
      left: channel % 2 === 0 ? 0.45 : 0,
      right: channel % 2 === 0 ? 0 : 0.45
    }
  )
}

function hrtfMonitorGain(label, channel) {
  const labelGains = {
    L: 1,
    R: 1,
    C: 0.707,
    FL: 1,
    FR: 1,
    FC: 0.707,
    LFE: 0,
    LS: 0.707,
    SL: 0.707,
    SR: 0.707,
    LSR: 0.707,
    RSR: 0.707,
    BL: 0.707,
    BR: 0.707,
    TFL: 0.707,
    TFR: 0.707,
    TBL: 0.707,
    TBR: 0.707
  }
  if (labelGains[label]) return labelGains[label]
  if (label === 'LFE') return 0
  return channel < 2 ? 1 : 0.7
}

function dbToAmplitude(db) {
  const numericDb = Number(db)
  if (!Number.isFinite(numericDb) || numericDb <= -119) return 0
  return 10 ** (numericDb / 20)
}

function amplitudeToDb(amplitude) {
  return amplitude <= 0 ? -120 : 20 * Math.log10(amplitude)
}

function selectedMonitorFormat() {
  const selectedChannels = selectedChannelIndexes()
  const sourceChannels =
    currentMonitorFormat?.channels || selectedChannels.length || defaultChannelCount()
  const lowLatencyMonitor = shouldUseLowLatencyMonitor(currentInputType, monitorMode.value)
  return {
    mode: monitorMode.value,
    deviceId: monitorDeviceList.value,
    pairStart: Number(monitorSourcePair.value || 0),
    latencyMs: effectiveMonitorLatencyMs(currentInputType, monitorMode.value),
    lowLatency: lowLatencyMonitor,
    volume: monitorVolumePercent(),
    sampleRate: currentMonitorFormat?.sampleRate || Number(sampleRateSelect.value),
    channels: sourceChannels,
    channelLabels: selectedTemplateChannelLabels(sourceChannels)
  }
}

function shouldUseLowLatencyMonitor(inputType = currentInputType, mode = monitorMode.value) {
  return inputType === 'app-audio' && mode === 'stereo-pair'
}

function effectiveMonitorLatencyMs(inputType = currentInputType, mode = monitorMode.value) {
  const selectedLatency = Number(monitorLatency.value || 80)
  return shouldUseLowLatencyMonitor(inputType, mode)
    ? Math.max(5, selectedLatency)
    : selectedLatency
}

function applyLowLatencyMonitorDefault() {
  if (!shouldUseLowLatencyMonitor()) return
  if (Number(monitorLatency.value || 80) > 5) {
    monitorLatency.value = '5'
  }
}

function monitorVolumePercent() {
  return Math.max(0, Math.min(1, Number(monitorVolume.value || 100) / 100))
}

function updateMonitorVolumeLabel() {
  monitorVolumeValue.textContent = `${Math.round(monitorVolumePercent() * 100)}%`
}

function formatSampleRate(sampleRate) {
  const numeric = Number(sampleRate)
  if (!Number.isFinite(numeric) || numeric <= 0) return ''
  const khz = numeric / 1000
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`
}

function actualBitrateValue() {
  const stereoKbps = Number(bitrateSelect.value || 128)
  const channels = Math.max(1, selectedChannelIndexes().length || defaultChannelCount())
  return `${Math.round(stereoKbps * Math.max(1, channels / 2))}k`
}

function updateBitrateActualLabel() {
  bitrateActualValue.textContent = `${actualBitrateValue().replace('k', ' kbps')} actual`
}

function monitorModeLabel(mode = monitorMode.value) {
  if (mode === 'binaural') return 'KU100 near-field HRTF'
  if (mode === 'downmix') return 'Stereo downmix'
  return `${monitorPairLabel(Number(monitorSourcePair.value || 0))} stereo pair`
}

function monitorPairLabel(pairStart) {
  const channels =
    currentMonitorFormat?.channels || selectedChannelIndexes().length || defaultChannelCount()
  const left = pairStart
  const right = Math.min(pairStart + 1, Math.max(0, channels - 1))
  const leftName = channelNames[left] || `CH${left + 1}`
  const rightName = channelNames[right] || `CH${right + 1}`
  return left === right ? `${leftName} mono` : `${leftName}/${rightName}`
}

function updateMonitorRoutingControls() {
  const previousPair = monitorSourcePair.value
  const channels =
    currentMonitorFormat?.channels || selectedChannelIndexes().length || defaultChannelCount()
  monitorSourcePair.innerHTML = ''

  for (let index = 0; index < Math.max(1, channels); index += 2) {
    const opt = document.createElement('option')
    opt.value = String(index)
    opt.textContent = monitorPairLabel(index)
    monitorSourcePair.appendChild(opt)
  }

  if (Array.from(monitorSourcePair.options).some((option) => option.value === previousPair)) {
    monitorSourcePair.value = previousPair
  }

  monitorPairGroup.classList.toggle('hidden', monitorMode.value !== 'stereo-pair')
}

function applyMonitorSettings(reason = 'settings') {
  monitorSettingsPromise = monitorSettingsPromise
    .catch(() => {})
    .then(async () => {
      if (!isMonitorAvailable()) {
        await forceStopPreviewMonitor()
        await window.api.setMonitorActive(false).catch(() => {})
        monitorMeterState.textContent = 'IDLE'
        resetMonitorPeakMeters()
        return
      }

      if (!isStreaming) {
        if (!monitorEnabled.checked || !supportsPreviewMonitor()) {
          await forceStopPreviewMonitor()
          monitorMeterState.textContent = 'IDLE'
          resetMonitorPeakMeters()
          return
        }

        await startPreviewMonitor(reason)
        return
      }

      if (!monitorEnabled.checked) {
        await forceStopPreviewMonitor()
        await window.api.setMonitorActive(false)
        monitorMeterState.textContent = 'IDLE'
        resetMonitorPeakMeters()
        addLog('Monitor output disabled.', 'system')
        return
      }

      const format = selectedMonitorFormat()
      await webAudioMonitor.start(format)
      await window.api.setMonitorActive(true)
      addLog(`Monitor output updated (${monitorModeLabel(format.mode)}, ${reason}).`, 'system')
    })
    .catch((err) => {
      addLog(`Error updating monitor output: ${err.message}`, 'error')
    })

  return monitorSettingsPromise
}

async function startInitialMonitor(config, channels) {
  if (!config.monitorEnabled) return

  const format = initialMonitorFormat(config, channels, streamingMonitorSampleRate(config))
  await webAudioMonitor.start({
    mode: format.mode,
    deviceId: config.monitorDeviceId,
    pairStart: format.pairStart,
    latencyMs: format.latencyMs,
    lowLatency: format.lowLatency,
    sampleRate: format.sampleRate,
    channels: format.channels,
    channelLabels: format.channelLabels,
    volume: monitorVolumePercent()
  })
  monitorMeterState.textContent = 'LIVE'
  renderMonitorPeakMeters(2)
  addLog(`Monitor output ready (${monitorModeLabel(config.monitorMode)}).`, 'system')
}

async function startPreviewMonitor(reason = 'settings') {
  const config = selectedPreviewMonitorConfig()
  if (!config) {
    await stopPreviewMonitor()
    await webAudioMonitor.stop()
    return
  }

  if (config.inputType === 'app-audio' && !config.appAudioPid) {
    await stopPreviewMonitor()
    await webAudioMonitor.stop()
    return
  }

  if (config.inputType === 'app-audio' && !config.appAudioDeviceUID) {
    await stopPreviewMonitor()
    await webAudioMonitor.stop()
    return
  }

  if (config.inputType === 'file' && !config.inputPath) {
    await stopPreviewMonitor()
    await webAudioMonitor.stop()
    return
  }

  if (config.inputType === 'device' && !config.inputPath) {
    await stopPreviewMonitor()
    await webAudioMonitor.stop()
    return
  }

  const key = JSON.stringify({
    inputType: config.inputType,
    inputPath: config.inputPath || '',
    selectedChannels: config.selectedChannels || [],
    streamChannelLayout: config.streamChannelLayout || '',
    loopFile: config.loopFile ?? '',
    pid: config.appAudioPid || '',
    inputChannels: config.inputChannels || '',
    sampleRate: config.sampleRate || config.appAudioSampleRate || '',
    mode: config.appAudioMode,
    deviceUID: config.appAudioDeviceUID || '',
    streamIndex: config.appAudioStreamIndex ?? '',
    outputDeviceId: monitorDeviceList.value || '',
    monitorMode: config.monitorMode,
    pairStart: config.monitorPairStart,
    latencyMs: config.monitorLatencyMs,
    lowLatency: config.monitorLowLatency
  })

  if (previewMonitorKey === key) {
    return
  }

  await stopPreviewMonitor()
  pendingPreviewStart = true
  const format = initialMonitorFormat(
    config,
    previewMonitorChannelCount(config),
    previewMonitorSampleRate(config)
  )
  try {
    await webAudioMonitor.start({
      mode: format.mode,
      deviceId: monitorDeviceList.value,
      pairStart: format.pairStart,
      latencyMs: format.latencyMs,
      lowLatency: format.lowLatency,
      sampleRate: format.sampleRate,
      channels: format.channels,
      channelLabels: format.channelLabels,
      volume: monitorVolumePercent()
    })
    monitorMeterState.textContent = 'PREVIEW'
    renderMonitorPeakMeters(2)

    const result =
      config.inputType === 'file'
        ? await window.api.startFileMonitor(config)
        : config.inputType === 'device'
          ? await window.api.startInputDeviceMonitor(config)
          : await window.api.startAppAudioMonitor(config)
    if (!result.success) {
      previewMonitorKey = ''
      await webAudioMonitor.stop()
      addLog(`Preview monitor failed: ${result.error}`, 'error')
      return
    }

    previewMonitorKey = key
    addLog(`Preview monitor active (${monitorModeLabel(config.monitorMode)}, ${reason}).`, 'system')
  } finally {
    pendingPreviewStart = false
  }
}

async function stopPreviewMonitor() {
  if (!previewMonitorKey) return
  previewMonitorKey = ''
  await window.api.stopPreviewMonitor().catch(() => {})
}

async function forceStopPreviewMonitor() {
  previewMonitorKey = ''
  pendingPreviewStart = false
  currentMonitorFormat = null
  monitorMeterState.textContent = 'IDLE'
  resetMonitorPeakMeters()
  await window.api.stopPreviewMonitor().catch(() => {})
  await webAudioMonitor.stop().catch(() => {})
}

function previewMonitorChannelCount(config) {
  if (config.inputType === 'app-audio') {
    return config.appAudioChannels || 2
  }
  if (config.inputType === 'device') {
    return config.inputChannels || 2
  }
  return config.selectedChannels?.length || defaultChannelCount()
}

function previewMonitorSampleRate(config) {
  if (config.inputType === 'app-audio') {
    return config.appAudioSampleRate || 48000
  }
  if (config.inputType === 'device') {
    return config.sampleRate || 48000
  }
  return streamOutputSampleRate(config.sampleRate || 48000)
}

function streamingMonitorSampleRate(config) {
  if (config.inputType === 'app-audio') {
    return config.appAudioSampleRate || 48000
  }
  return streamOutputSampleRate(config.sampleRate || 48000)
}

function streamOutputSampleRate(sampleRate) {
  const supportedRates = [48000, 24000, 16000, 12000, 8000]
  const numeric = Math.round(Number(sampleRate))
  return supportedRates.includes(numeric) ? numeric : 48000
}

function initialMonitorFormat(config, streamChannels, sampleRateOverride = null) {
  const isDirectAppAudioMonitor = config.inputType === 'app-audio'
  const isDirectDeviceMonitor = config.inputType === 'device'
  return {
    mode: config.monitorMode || 'stereo-pair',
    pairStart: config.monitorPairStart || 0,
    latencyMs: config.monitorLatencyMs || 80,
    lowLatency: !!config.monitorLowLatency,
    sampleRate:
      sampleRateOverride ||
      (isDirectAppAudioMonitor ? config.appAudioSampleRate || 48000 : config.sampleRate || 48000),
    channels: isDirectAppAudioMonitor
      ? config.appAudioChannels || 2
      : isDirectDeviceMonitor
        ? config.inputChannels || 2
        : streamChannels,
    channelLabels: selectedTemplateChannelLabels(
      isDirectAppAudioMonitor
        ? config.appAudioChannels || 2
        : isDirectDeviceMonitor
          ? config.inputChannels || 2
          : streamChannels
    )
  }
}

tabFile.addEventListener('click', () => {
  showInputSection('file')
})

tabDevice.addEventListener('click', () => {
  showInputSection('device')
  refreshDevices()
})

tabAppAudio.addEventListener('click', async () => {
  showInputSection('app-audio')
  await Promise.all([refreshAppAudioProcesses(), refreshAppAudioOutputStreams()])
  applyMonitorSettings('app-scan')
})

btnRefreshDevices.addEventListener('click', refreshDevices)
deviceList.addEventListener('change', () => {
  syncInputSettings(true)
  warnIfLoopbackInputDevice(selectedInputDevice())
  applyMonitorSettings('device-input')
})
btnRefreshMonitorDevices.addEventListener('click', () => refreshMonitorDevices(true))
monitorEnabled.addEventListener('change', () => applyMonitorSettings('enabled'))
monitorDeviceList.addEventListener('change', () => applyMonitorSettings('device'))
monitorMode.addEventListener('change', () => {
  updateMonitorRoutingControls()
  applyLowLatencyMonitorDefault()
  applyMonitorSettings('mode')
})
monitorSourcePair.addEventListener('change', () => applyMonitorSettings('source'))
monitorLatency.addEventListener('change', () => applyMonitorSettings('latency'))
monitorVolume.addEventListener('input', () => {
  if (!isMonitorAvailable()) return
  updateMonitorVolumeLabel()
  webAudioMonitor.setVolume(monitorVolumePercent())
})
icecastSettingsFields.forEach((field) => {
  field.addEventListener('change', saveIcecastSettings)
  field.addEventListener('input', saveIcecastSettings)
})
bitrateSelect.addEventListener('change', updateBitrateActualLabel)
channelTemplateSelect.addEventListener('change', () => {
  updateChannelControls(true, channelTemplateSelect.value)
  applyMonitorSettings('template')
})
btnRefreshAppAudio.addEventListener('click', async () => {
  await forceStopPreviewMonitor()
  await Promise.all([refreshAppAudioProcesses(), refreshAppAudioOutputStreams()])
  applyMonitorSettings('refresh')
})
appAudioList.addEventListener('change', async () => {
  await forceStopPreviewMonitor()
  applyMonitorSettings('app')
})
appAudioOutputStream.addEventListener('change', async () => {
  await forceStopPreviewMonitor()
  syncInputSettings(true)
  applyMonitorSettings('stream')
})
btnSelectDefaultChannels.addEventListener('click', () => updateChannelControls(true))
btnSelectDefaultChannels.addEventListener('click', () => applyMonitorSettings('channels'))

btnBrowse.addEventListener('click', async () => {
  const path = await window.api.openFile()
  if (path) {
    filePathInput.value = path
    addLog(`Selected file: ${path}`)
    try {
      fileInputInfo = await window.api.probeAudio(path)
      addLog(
        `File audio: ${fileInputInfo.channels || '?'}ch @ ${formatSampleRate(fileInputInfo.sampleRate) || '?'}${fileInputInfo.layout ? ` (${fileInputInfo.layout})` : ''}`,
        'system'
      )
    } catch (err) {
      fileInputInfo = null
      addLog(`Could not read file audio format: ${err.message}`, 'error')
    }
    syncInputSettings(true)
    applyMonitorSettings('file')
  }
})

btnStart.addEventListener('click', async () => {
  if (!isSourceSupported(currentInputType)) {
    addLog(
      'Error: The selected input source is not supported by the current audio backend.',
      'error'
    )
    return
  }

  const appAudioPid = appAudioList.value
  const stream = selectedAppAudioStream()
  const inputDevice = selectedInputDevice()
  const selectedChannels = selectedChannelIndexes()
  const inputInfo = selectedInputInfo()

  const config = {
    inputType: currentInputType,
    inputPath:
      currentInputType === 'file'
        ? filePathInput.value
        : currentInputType === 'device'
          ? selectedInputDevicePath()
          : appAudioPid,
    inputChannels:
      currentInputType === 'device' ? inputDevice?.channels || inputInfo.channels : undefined,
    inputSampleRate:
      currentInputType === 'device' ? inputDevice?.sampleRate || inputInfo.sampleRate : undefined,
    inputDeviceUID: currentInputType === 'device' ? inputDevice?.deviceUID : undefined,
    inputStreamIndex: currentInputType === 'device' ? inputDevice?.streamIndex : undefined,
    inputDeviceName: currentInputType === 'device' ? inputDevice?.name : undefined,
    appAudioPid: currentInputType === 'app-audio' ? Number(appAudioPid) : undefined,
    appAudioMode: currentInputType === 'app-audio' ? 'preserve' : undefined,
    appAudioDeviceUID: stream?.deviceUID,
    appAudioStreamIndex: stream?.streamIndex,
    appAudioSampleRate: stream?.sampleRate,
    appAudioChannels: stream?.channels || 2,
    selectedChannels,
    streamChannelLayout: selectedStreamLayout(),
    sampleRate: inputInfo.sampleRate || Number(sampleRateSelect.value),
    bitrate: actualBitrateValue(),
    monitorEnabled: isMonitorAvailable() && monitorEnabled.checked,
    monitorDeviceId: isMonitorAvailable() && monitorEnabled.checked ? monitorDeviceList.value : '',
    monitorMode: monitorMode.value,
    monitorPairStart: Number(monitorSourcePair.value || 0),
    monitorLatencyMs: effectiveMonitorLatencyMs(currentInputType, monitorMode.value),
    monitorLowLatency: shouldUseLowLatencyMonitor(currentInputType, monitorMode.value),
    monitorVolume: monitorVolumePercent(),
    icecastHost: icecastHostInput.value.trim(),
    icecastPort: icecastPortInput.value.trim(),
    mountPoint: normalizeMountPoint(mountPointInput.value),
    sourcePassword: sourcePasswordInput.value,
    loopFile: currentInputType === 'file' && loopFileInput.checked
  }
  saveIcecastSettings()

  if (selectedChannels.length === 0) {
    addLog('Error: At least one stream channel must be enabled.', 'error')
    return
  }

  if (currentInputType === 'file' && !config.inputPath) {
    addLog('Error: No input source selected.', 'error')
    return
  }

  if (currentInputType === 'device' && !config.inputPath) {
    addLog('Error: No input source selected.', 'error')
    return
  }

  if (currentInputType === 'device' && !(await ensureMicrophoneAccess('streaming'))) {
    return
  }

  if (currentInputType === 'device') {
    warnIfLoopbackInputDevice(inputDevice)
  }

  if (currentInputType === 'app-audio' && !config.appAudioPid) {
    addLog(
      `Error: No ${isWindowsOutputLoopbackMode() ? 'output loopback source' : 'app audio process'} selected.`,
      'error'
    )
    return
  }

  if (currentInputType === 'app-audio' && !stream) {
    addLog(
      `Error: No ${isWindowsOutputLoopbackMode() ? 'loopback device' : 'output stream'} selected for capture.`,
      'error'
    )
    return
  }

  renderPeakMeters(selectedChannels.length)

  try {
    await stopPreviewMonitor()
    await startInitialMonitor(config, selectedChannels.length)
  } catch (err) {
    addLog(`Error starting monitor output: ${err.message}`, 'error')
    await webAudioMonitor.stop()
    return
  }

  if (currentInputType === 'app-audio') {
    addLog(
      isWindowsOutputLoopbackMode()
        ? `Starting stream from output loopback (${config.appAudioChannels}ch)...`
        : `Starting stream from app audio tap (${config.appAudioChannels}ch preserve surround)...`,
      'system'
    )
  } else {
    addLog('Starting stream...', 'system')
  }
  const result = await window.api.startStream(config)

  if (result.success) {
    addLog('Stream started successfully!', 'system')
    setStreamingState(true)
    if (monitorEnabled.checked && currentMonitorFormat) {
      applyMonitorSettings('format')
    }
  } else {
    addLog(`Failed to start stream: ${result.error}`, 'error')
    await window.api.setMonitorActive(false).catch(() => {})
    await webAudioMonitor.stop()
    setStreamingState(false)
  }
})

btnStop.addEventListener('click', async () => {
  addLog('Stopping stream...', 'system')
  await window.api.setMonitorActive(false).catch(() => {})
  await window.api.stopStream()
  setStreamingState(false)

  if (monitorEnabled.checked && supportsPreviewMonitor()) {
    await applyMonitorSettings('post-stop')
  } else {
    monitorMeterState.textContent = 'IDLE'
    resetMonitorPeakMeters()
  }

  addLog('Stream stopped.', 'system')
})

window.api.onFfmpegLog(({ message, type }) => {
  if (message) addLog(message, type, { record: false })
})

window.api.onStreamStatus(({ isRunning }) => {
  if (!isRunning) {
    currentMonitorFormat = null
    window.api.setMonitorActive(false).catch(() => {})
    setStreamingState(false)
    if (monitorEnabled.checked && supportsPreviewMonitor()) {
      applyMonitorSettings('status')
    } else {
      webAudioMonitor.stop()
      monitorMeterState.textContent = 'IDLE'
      resetMonitorPeakMeters()
    }
    return
  }
  setStreamingState(isRunning)
})

window.api.onMonitorFormat((format) => {
  currentMonitorFormat = format
  updateMonitorRoutingControls()
  renderMonitorPeakMeters(2)
  addLog(`Monitor PCM: ${format.channels}ch @ ${formatSampleRate(format.sampleRate)}`, 'system')
  if (isStreaming && monitorEnabled.checked) {
    applyMonitorSettings('format')
  }
})

window.api.onMonitorAudio((payload) => {
  webAudioMonitor.pushChunk(payload.chunk)
  const now = performance.now()
  if (now - lastMonitorPeakUpdateAt >= 100) {
    lastMonitorPeakUpdateAt = now
    const monitorPeaks = calculateMonitorOutputPeaks(payload.chunk, selectedMonitorFormat())
    if (monitorPeaks) {
      updateMonitorPeakMeters(monitorPeaks)
    }
  }
})

window.api.onMonitorStop(() => {
  currentMonitorFormat = null
  previewMonitorKey = ''
  if (!pendingPreviewStart) {
    webAudioMonitor.stop()
  }
  monitorMeterState.textContent = 'IDLE'
  resetMonitorPeakMeters()
})

window.api.onStreamMeter((payload) => {
  updatePeakMeters(payload)
})

async function initializeApp() {
  loadIcecastSettings()
  await loadAudioBackendCapabilities()
  bitrateSelect.value = '128'
  sampleRateSelect.value = '48000'
  updateChannelControls(true)
  updateMonitorRoutingControls()
  updateMonitorVolumeLabel()
  updateMonitorAvailability()
  renderMonitorPeakMeters(2)
  if (audioBackendCapabilities.appAudioCapture) {
    await Promise.all([refreshAppAudioProcesses(), refreshAppAudioOutputStreams()])
  }
  refreshMonitorDevices()
  addLog('SurroundStreamer initialized.', 'system')
}

initializeApp()
