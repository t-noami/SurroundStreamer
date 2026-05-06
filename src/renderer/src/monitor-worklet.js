class PcmMonitorSourceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.channels = Math.max(1, Number(options.processorOptions?.channels || 2))
    this.queue = []
    this.bufferedFrames = 0
    this.maxBufferedFrames = Math.floor(sampleRate * 1.5)

    this.port.onmessage = (event) => {
      const { type, chunk, channels } = event.data || {}
      if (type === 'format') {
        this.channels = Math.max(1, Number(channels || this.channels))
        this.queue = []
        this.bufferedFrames = 0
        return
      }

      if (type !== 'chunk' || !chunk) return

      const samples = new Float32Array(chunk)
      const frames = Math.floor(samples.length / this.channels)
      if (frames <= 0) return

      this.queue.push({ samples, frames, frameOffset: 0 })
      this.bufferedFrames += frames

      while (this.bufferedFrames > this.maxBufferedFrames && this.queue.length > 1) {
        const dropped = this.queue.shift()
        this.bufferedFrames -= dropped.frames - dropped.frameOffset
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

registerProcessor('pcm-monitor-source', PcmMonitorSourceProcessor)
