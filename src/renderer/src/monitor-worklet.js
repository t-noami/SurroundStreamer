class PcmMonitorSourceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.channels = Math.max(1, Number(options.processorOptions?.channels || 2))
    this.lowLatency = !!options.processorOptions?.lowLatency
    this.latencyMs = clampNumber(options.processorOptions?.latencyMs, 5, 500, 80)
    this.queue = []
    this.bufferedFrames = 0
    this.updateBufferLimits()

    this.port.onmessage = (event) => {
      const { type, chunk, channels, latencyMs, lowLatency } = event.data || {}
      if (type === 'format') {
        this.channels = Math.max(1, Number(channels || this.channels))
        if (typeof lowLatency === 'boolean') {
          this.lowLatency = lowLatency
        }
        this.latencyMs = clampNumber(latencyMs, 5, 500, this.latencyMs)
        this.updateBufferLimits()
        this.queue = []
        this.bufferedFrames = 0
        return
      }

      if (type !== 'chunk' || !chunk) return

      const sampleBytes = Math.floor(chunk.byteLength / 4) * 4
      if (sampleBytes <= 0) return

      const samples =
        sampleBytes === chunk.byteLength
          ? new Float32Array(chunk)
          : new Float32Array(chunk.slice(0, sampleBytes))
      const frames = Math.floor(samples.length / this.channels)
      if (frames <= 0) return

      this.queue.push({ samples, frames, frameOffset: 0 })
      this.bufferedFrames += frames

      if (this.bufferedFrames > this.maxBufferedFrames) {
        this.dropOldestFrames(this.bufferedFrames - this.targetBufferedFrames)
      }
    }
  }

  updateBufferLimits() {
    this.targetBufferedFrames = Math.max(128, Math.floor((sampleRate * this.latencyMs) / 1000))
    const extraFrames = this.lowLatency ? Math.floor(sampleRate * 0.01) : this.targetBufferedFrames
    this.maxBufferedFrames = Math.max(256, this.targetBufferedFrames + extraFrames)
  }

  dropOldestFrames(framesToDrop) {
    let remaining = Math.max(0, Math.floor(framesToDrop))
    while (remaining > 0 && this.queue.length > 0) {
      const current = this.queue[0]
      const available = current.frames - current.frameOffset
      if (available <= remaining) {
        this.queue.shift()
        this.bufferedFrames -= available
        remaining -= available
      } else {
        current.frameOffset += remaining
        this.bufferedFrames -= remaining
        remaining = 0
      }
    }
  }

  process(_inputs, outputs) {
    for (let frame = 0; frame < 128; frame += 1) {
      const current = this.queue[0]
      if (!current) {
        for (const output of outputs) {
          if (output[0]) output[0][frame] = 0
        }
        continue
      }

      const base = current.frameOffset * this.channels
      for (let channel = 0; channel < outputs.length; channel += 1) {
        const output = outputs[channel]
        if (!output[0]) continue
        output[0][frame] = current.samples[base + channel] || 0
      }

      current.frameOffset += 1
      this.bufferedFrames -= 1
      if (current.frameOffset >= current.frames) {
        this.queue.shift()
      }
    }

    return true
  }
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

registerProcessor('pcm-monitor-source', PcmMonitorSourceProcessor)
