const statusBadge = document.getElementById('status-badge')
const btnStart = document.getElementById('btn-start')
const btnStop = document.getElementById('btn-stop')
const logOutput = document.getElementById('log-output')
const streamTimer = document.getElementById('stream-timer')

const tabFile = document.getElementById('tab-file')
const tabDevice = document.getElementById('tab-device')
const fileInputSection = document.getElementById('file-input-section')
const deviceInputSection = document.getElementById('device-input-section')

const deviceList = document.getElementById('device-list')
const btnRefreshDevices = document.getElementById('btn-refresh-devices')
const btnBrowse = document.getElementById('btn-browse')
const filePathInput = document.getElementById('file-path')
const loopFileInput = document.getElementById('loop-file')

let startTime = null
let timerInterval = null
let currentInputType = 'file'

// --- Utility Functions ---

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

function setStreamingState(isStreaming) {
  statusBadge.textContent = isStreaming ? 'LIVE' : 'IDLE'
  statusBadge.classList.toggle('live', isStreaming)
  statusBadge.classList.toggle('idle', !isStreaming)
  btnStart.classList.toggle('hidden', isStreaming)
  btnStop.classList.toggle('hidden', !isStreaming)

  if (isStreaming && !startTime) {
    startTime = Date.now()
    timerInterval = setInterval(updateTimer, 1000)
  }

  if (!isStreaming) {
    clearInterval(timerInterval)
    timerInterval = null
    startTime = null
    streamTimer.textContent = '00:00:00'
  }
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

// --- Event Handlers ---

tabFile.addEventListener('click', () => {
  currentInputType = 'file'
  tabFile.classList.add('active')
  tabDevice.classList.remove('active')
  fileInputSection.classList.remove('hidden')
  deviceInputSection.classList.add('hidden')
})

tabDevice.addEventListener('click', () => {
  currentInputType = 'device'
  tabDevice.classList.add('active')
  tabFile.classList.remove('active')
  deviceInputSection.classList.remove('hidden')
  fileInputSection.classList.add('hidden')
  refreshDevices()
})

btnRefreshDevices.addEventListener('click', refreshDevices)

btnBrowse.addEventListener('click', async () => {
  const path = await window.api.openFile()
  if (path) {
    filePathInput.value = path
    addLog(`Selected file: ${path}`)
  }
})

btnStart.addEventListener('click', async () => {
  const config = {
    inputType: currentInputType,
    inputPath: currentInputType === 'file' ? filePathInput.value : `:${deviceList.value}`,
    icecastHost: document.getElementById('icecast-host').value,
    icecastPort: document.getElementById('icecast-port').value,
    mountPoint: document.getElementById('mount-point').value,
    sourcePassword: document.getElementById('source-password').value,
    loopFile: currentInputType === 'file' && loopFileInput.checked,
    bitrate: '384k' // Default
  }

  if (!config.inputPath || (currentInputType === 'device' && config.inputPath === ':')) {
    addLog('Error: No input source selected.', 'error')
    return
  }

  addLog('Starting stream...', 'system')
  const result = await window.api.startStream(config)

  if (result.success) {
    addLog('Stream started successfully!', 'system')
    setStreamingState(true)
  } else {
    addLog(`Failed to start stream: ${result.error}`, 'error')
    setStreamingState(false)
  }
})

btnStop.addEventListener('click', async () => {
  addLog('Stopping stream...', 'system')
  await window.api.stopStream()

  addLog('Stream stopped.', 'system')
  setStreamingState(false)
})

window.api.onFfmpegLog(({ message, type }) => {
  if (message) addLog(message, type)
})

window.api.onStreamStatus(({ isRunning }) => {
  setStreamingState(isRunning)
})

// Initial Setup
refreshDevices()
addLog('SurroundStreamer initialized.', 'system')
