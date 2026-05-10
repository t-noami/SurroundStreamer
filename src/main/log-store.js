import { EventEmitter } from 'events'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const MAX_LOG_ENTRIES = 2000
const LOG_FILE_NAME = 'surround-streamer.log'

class LogStore extends EventEmitter {
  constructor() {
    super()
    this.entries = []
  }

  append(payload = {}) {
    const entry = {
      timestamp: Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now(),
      type: typeof payload.type === 'string' && payload.type ? payload.type : 'system',
      message: typeof payload.message === 'string' ? payload.message : String(payload.message ?? '')
    }

    if (!entry.message) {
      return null
    }

    this.entries.push(entry)
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_LOG_ENTRIES)
    }

    this.writeEntry(entry)
    this.emit('entry', entry)
    return entry
  }

  getEntries() {
    return [...this.entries]
  }

  writeEntry(entry) {
    try {
      const userData = app.getPath('userData')
      mkdirSync(userData, { recursive: true })
      appendFileSync(
        join(userData, LOG_FILE_NAME),
        `${new Date(entry.timestamp).toISOString()} [${entry.type}] ${entry.message}\n`,
        'utf8'
      )
    } catch {
      // Logging must never break the app path it is trying to describe.
    }
  }
}

export default new LogStore()
