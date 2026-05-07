import { EventEmitter } from 'events'

const MAX_LOG_ENTRIES = 2000

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

    this.emit('entry', entry)
    return entry
  }

  getEntries() {
    return [...this.entries]
  }
}

export default new LogStore()
