const logOutput = document.getElementById('log-window-output')
const logCount = document.getElementById('log-count')

let entriesRendered = 0

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString()
}

function renderEntry(entry) {
  if (!entry?.message) return

  const element = document.createElement('div')
  element.className = `log-entry ${entry.type || 'system'}`
  element.textContent = `[${formatTimestamp(entry.timestamp || Date.now())}] ${entry.message}`
  logOutput.appendChild(element)
  logOutput.scrollTop = logOutput.scrollHeight
  entriesRendered += 1
  logCount.textContent = String(entriesRendered)
}

async function initializeLogs() {
  const entries = await window.api.getLogs()
  if (!entries.length) {
    renderEntry({
      timestamp: Date.now(),
      type: 'system',
      message: 'No log entries yet.'
    })
    entriesRendered = 0
    logCount.textContent = '0'
    return
  }

  entries.forEach(renderEntry)
}

window.api.onLogEntry(renderEntry)

initializeLogs().catch((error) => {
  renderEntry({
    timestamp: Date.now(),
    type: 'error',
    message: `Could not load logs: ${error.message}`
  })
})
