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
const appAudioMode = document.getElementById('app-audio-mode')
const appAudioOutputStream = document.getElementById('app-audio-output-stream')
const btnRefreshAppAudio = document.getElementById('btn-refresh-app-audio')
const btnTestAppAudio = document.getElementById('btn-test-app-audio')

const bitrateSelect = document.getElementById('bitrate-select')
const sampleRateSelect = document.getElementById('sample-rate-select')
const channelSelector = document.getElementById('channel-selector')
const btnSelectDefaultChannels = document.getElementById('btn-select-default-channels')
const peakMeterList = document.getElementById('peak-meter-list')
const meterState = document.getElementById('meter-state')
const monitorEnabled = document.getElementById('monitor-enabled')
const monitorDeviceList = document.getElementById('monitor-device-list')
const monitorMode = document.getElementById('monitor-mode')
const btnRefreshMonitorDevices = document.getElementById('btn-refresh-monitor-devices')

const channelNames = ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BL', 'BR']

let startTime = null
let timerInterval = null
let currentInputType = 'file'
let activeMeterChannels = 6
let isStreaming = false
let currentMonitorFormat = null
let monitorSettingsPromise = Promise.resolve()
const webAudioMonitor = new WebAudioMonitor(addLog)

function addLog(message, type = 'system') {
  const entry = document.createElement('div')
  entry.className = `log-entry ${type}`
  const timestamp = new Date().toLocaleTimeString()
  entry.textContent = `[${timestamp}] ${message}`
  logOutput.appendChild(entry)
  logOutput.scrollTop = logOutput.scrollHeight
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

function showInputSection(inputType) {
  currentInputType = inputType
  tabFile.classList.toggle('active', inputType === 'file')
  tabDevice.classList.toggle('active', inputType === 'device')
  tabAppAudio.classList.toggle('active', inputType === 'app-audio')
  fileInputSection.classList.toggle('hidden', inputType !== 'file')
  deviceInputSection.classList.toggle('hidden', inputType !== 'device')
  appAudioInputSection.classList.toggle('hidden', inputType !== 'app-audio')
  updateChannelControls()
}

async function refreshDevices() {
  addLog('Scanning audio devices...', 'system')
  try {
    const devices = await window.api.listDevices()
    deviceList.innerHTML = ''
    if (devices.length === 0) {
      deviceList.innerHTML = '<option value="">No audio devices found</option>'
    } else {
      devices.forEach((dev) => {
        const opt = document.createElement('option')
        opt.value = dev.index
        opt.textContent = `[${dev.index}] ${dev.name}`
        deviceList.appendChild(opt)
      })
    }
    addLog(`Found ${devices.length} devices.`, 'system')
  } catch (err) {
    addLog(`Error listing devices: ${err.message}`, 'error')
  }
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
  addLog('Scanning app audio processes...', 'system')
  try {
    const result = await window.api.listAppAudioProcesses()
    const processes = result.processes || []
    appAudioList.innerHTML = ''
    if (processes.length === 0) {
      appAudioList.innerHTML = '<option value="">No app audio processes found</option>'
    } else {
      processes.forEach((process) => {
        const opt = document.createElement('option')
        opt.value = process.pid
        opt.textContent = `${process.isRunningOutput ? '* ' : ''}${process.name} [${process.pid}]`
        appAudioList.appendChild(opt)
      })
    }
    addLog(`Found ${processes.length} app audio processes.`, 'system')
  } catch (err) {
    addLog(`Error listing app audio processes: ${err.message}`, 'error')
  }
}

async function refreshAppAudioOutputStreams() {
  addLog('Scanning output streams for surround capture...', 'system')
  try {
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
        opt.textContent = `${device.name} / stream ${stream.streamIndex}: ${payload.channels}ch @ ${payload.sampleRate}Hz`
        appAudioOutputStream.appendChild(opt)
      })
    })

    if (streamCount === 0) {
      appAudioOutputStream.innerHTML = '<option value="">No output streams found</option>'
    }

    addLog(`Found ${streamCount} output streams.`, 'system')
    updateChannelControls()
  } catch (err) {
    addLog(`Error listing output streams: ${err.message}`, 'error')
  }
}

function selectedAppAudioStream() {
  if (appAudioMode.value !== 'preserve' || !appAudioOutputStream.value) {
    return null
  }

  try {
    return JSON.parse(appAudioOutputStream.value)
  } catch {
    return null
  }
}

function getAvailableChannelCount() {
  if (currentInputType === 'app-audio') {
    if (appAudioMode.value === 'preserve') {
      return selectedAppAudioStream()?.channels || 2
    }
    return 2
  }

  return 8
}

function defaultChannelCount() {
  if (currentInputType === 'app-audio') {
    return getAvailableChannelCount()
  }
  return 6
}

function updateChannelControls(useDefaults = false) {
  const maxChannels = getAvailableChannelCount()
  const defaults = defaultChannelCount()
  const previous = new Set(selectedChannelIndexes())

  channelSelector.innerHTML = ''
  for (let index = 0; index < Math.min(maxChannels, 8); index += 1) {
    const label = document.createElement('label')
    label.className = 'channel-toggle'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = String(index)
    input.checked = useDefaults
      ? index < defaults
      : previous.size === 0
        ? index < defaults
        : previous.has(index)
    input.addEventListener('change', () => {
      renderPeakMeters(selectedChannelIndexes().length || 1)
    })

    const text = document.createElement('span')
    text.textContent = `${index + 1} ${channelNames[index] || `CH${index + 1}`}`

    label.appendChild(input)
    label.appendChild(text)
    channelSelector.appendChild(label)
  }

  renderPeakMeters(selectedChannelIndexes().length || defaults)
}

function selectedChannelIndexes() {
  return Array.from(channelSelector.querySelectorAll('input:checked')).map((input) =>
    Number(input.value)
  )
}

function renderPeakMeters(channels) {
  activeMeterChannels = Math.max(1, channels)
  peakMeterList.innerHTML = ''

  for (let index = 0; index < activeMeterChannels; index += 1) {
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
    peakMeterList.appendChild(row)
  }
}

function resetPeakMeters() {
  peakMeterList.querySelectorAll('.peak-row').forEach((row) => {
    row.querySelector('.peak-fill').style.width = '0%'
    row.querySelector('.peak-value').textContent = '-inf'
  })
}

function updatePeakMeters(payload) {
  const channels = payload.channels || activeMeterChannels
  if (channels !== activeMeterChannels) {
    renderPeakMeters(channels)
  }

  Object.entries(payload.peaks || {}).forEach(([channel, db]) => {
    const row = peakMeterList.querySelector(`[data-channel="${channel}"]`)
    if (!row) return

    const numericDb = Number(db)
    const clamped = Math.max(-60, Math.min(0, numericDb))
    const percent = ((clamped + 60) / 60) * 100
    row.querySelector('.peak-fill').style.width = `${percent}%`
    row.querySelector('.peak-value').textContent =
      numericDb <= -119 ? '-inf' : `${numericDb.toFixed(1)} dB`
  })
}

function selectedMonitorFormat() {
  const selectedChannels = selectedChannelIndexes()
  return {
    mode: monitorMode.value,
    deviceId: monitorDeviceList.value,
    sampleRate: currentMonitorFormat?.sampleRate || Number(sampleRateSelect.value),
    channels: currentMonitorFormat?.channels || selectedChannels.length || defaultChannelCount()
  }
}

function monitorModeLabel(mode = monitorMode.value) {
  return mode === 'binaural' ? 'Web Audio HRTF' : 'Ch1/Ch2 stereo'
}

function applyMonitorSettings(reason = 'settings') {
  monitorSettingsPromise = monitorSettingsPromise
    .catch(() => {})
    .then(async () => {
      if (!isStreaming) return

      if (!monitorEnabled.checked) {
        await window.api.setMonitorActive(false)
        await webAudioMonitor.stop()
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

  await webAudioMonitor.start({
    mode: config.monitorMode,
    deviceId: config.monitorDeviceId,
    sampleRate: config.sampleRate,
    channels
  })
  addLog(`Monitor output ready (${monitorModeLabel(config.monitorMode)}).`, 'system')
}

tabFile.addEventListener('click', () => {
  showInputSection('file')
})

tabDevice.addEventListener('click', () => {
  showInputSection('device')
  refreshDevices()
})

tabAppAudio.addEventListener('click', () => {
  showInputSection('app-audio')
  refreshAppAudioProcesses()
  refreshAppAudioOutputStreams()
})

btnRefreshDevices.addEventListener('click', refreshDevices)
btnRefreshMonitorDevices.addEventListener('click', () => refreshMonitorDevices(true))
monitorEnabled.addEventListener('change', () => applyMonitorSettings('enabled'))
monitorDeviceList.addEventListener('change', () => applyMonitorSettings('device'))
monitorMode.addEventListener('change', () => applyMonitorSettings('mode'))
btnRefreshAppAudio.addEventListener('click', () => {
  refreshAppAudioProcesses()
  refreshAppAudioOutputStreams()
})
appAudioMode.addEventListener('change', () => updateChannelControls(true))
appAudioOutputStream.addEventListener('change', () => updateChannelControls(true))
btnSelectDefaultChannels.addEventListener('click', () => updateChannelControls(true))

btnTestAppAudio.addEventListener('click', async () => {
  const pid = appAudioList.value
  if (!pid) {
    addLog('Error: No app audio process selected.', 'error')
    return
  }

  addLog(`Creating short app audio tap for PID ${pid}...`, 'system')
  try {
    const stream = selectedAppAudioStream()
    const result = await window.api.createAppAudioTap({
      pid: Number(pid),
      options: stream ? { deviceUID: stream.deviceUID, streamIndex: stream.streamIndex } : {}
    })
    const format = result.format
    if (format) {
      addLog(`Tap OK: ${format.channels}ch @ ${format.sampleRate}Hz`, 'system')
    } else {
      addLog('Tap OK: format unavailable until tapped app outputs audio.', 'system')
    }
  } catch (err) {
    addLog(`Tap test failed: ${err.message}`, 'error')
  }
})

btnBrowse.addEventListener('click', async () => {
  const path = await window.api.openFile()
  if (path) {
    filePathInput.value = path
    addLog(`Selected file: ${path}`)
  }
})

btnStart.addEventListener('click', async () => {
  const appAudioPid = appAudioList.value
  const stream = selectedAppAudioStream()
  const selectedChannels = selectedChannelIndexes()

  const config = {
    inputType: currentInputType,
    inputPath:
      currentInputType === 'file'
        ? filePathInput.value
        : currentInputType === 'device'
          ? `:${deviceList.value}`
          : appAudioPid,
    appAudioPid: currentInputType === 'app-audio' ? Number(appAudioPid) : undefined,
    appAudioMode: currentInputType === 'app-audio' ? appAudioMode.value : undefined,
    appAudioDeviceUID: stream?.deviceUID,
    appAudioStreamIndex: stream?.streamIndex,
    appAudioSampleRate: stream?.sampleRate,
    appAudioChannels: appAudioMode.value === 'preserve' ? stream?.channels : 2,
    selectedChannels,
    sampleRate: Number(sampleRateSelect.value),
    bitrate: bitrateSelect.value,
    monitorEnabled: monitorEnabled.checked,
    monitorDeviceId: monitorEnabled.checked ? monitorDeviceList.value : '',
    monitorMode: monitorMode.value,
    icecastHost: document.getElementById('icecast-host').value,
    icecastPort: document.getElementById('icecast-port').value,
    mountPoint: document.getElementById('mount-point').value,
    sourcePassword: document.getElementById('source-password').value,
    loopFile: currentInputType === 'file' && loopFileInput.checked
  }

  if (selectedChannels.length === 0) {
    addLog('Error: At least one stream channel must be enabled.', 'error')
    return
  }

  if (currentInputType === 'file' && !config.inputPath) {
    addLog('Error: No input source selected.', 'error')
    return
  }

  if (currentInputType === 'device' && config.inputPath === ':') {
    addLog('Error: No input source selected.', 'error')
    return
  }

  if (currentInputType === 'app-audio' && !config.appAudioPid) {
    addLog('Error: No app audio process selected.', 'error')
    return
  }

  if (currentInputType === 'app-audio' && appAudioMode.value === 'preserve' && !stream) {
    addLog('Error: No output stream selected for surround capture.', 'error')
    return
  }

  renderPeakMeters(selectedChannels.length)

  try {
    await startInitialMonitor(config, selectedChannels.length)
  } catch (err) {
    addLog(`Error starting monitor output: ${err.message}`, 'error')
    await webAudioMonitor.stop()
    return
  }

  if (currentInputType === 'app-audio') {
    const modeText =
      appAudioMode.value === 'preserve'
        ? `${config.appAudioChannels}ch preserve surround`
        : 'stereo mixdown'
    addLog(`Starting stream from app audio tap (${modeText})...`, 'system')
  } else {
    addLog('Starting stream...', 'system')
  }
  const result = await window.api.startStream(config)

  if (result.success) {
    addLog('Stream started successfully!', 'system')
    setStreamingState(true)
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
  await webAudioMonitor.stop()

  addLog('Stream stopped.', 'system')
  setStreamingState(false)
})

window.api.onFfmpegLog(({ message, type }) => {
  if (message) addLog(message, type)
})

window.api.onStreamStatus(({ isRunning }) => {
  if (!isRunning) {
    currentMonitorFormat = null
    window.api.setMonitorActive(false).catch(() => {})
    webAudioMonitor.stop()
  }
  setStreamingState(isRunning)
})

window.api.onMonitorFormat((format) => {
  currentMonitorFormat = format
  addLog(`Monitor PCM: ${format.channels}ch @ ${format.sampleRate}Hz`, 'system')
  if (isStreaming && monitorEnabled.checked) {
    applyMonitorSettings('format')
  }
})

window.api.onMonitorAudio((payload) => {
  webAudioMonitor.pushChunk(payload.chunk)
})

window.api.onMonitorStop(() => {
  currentMonitorFormat = null
  webAudioMonitor.stop()
})

window.api.onStreamMeter((payload) => {
  updatePeakMeters(payload)
})

updateChannelControls(true)
refreshDevices()
refreshMonitorDevices()
addLog('SurroundStreamer initialized.', 'system')
