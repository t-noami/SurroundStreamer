class PcmMonitorSourceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.channels = Math.max(1, Number(options.processorOptions?.channels || 2))
    this.outputMode = normalizeOutputMode(options.processorOptions?.outputMode)
    this.channelLabels = normalizeChannelLabels(
      options.processorOptions?.channelLabels,
      this.channels
    )
    this.monitorChannelIndexes = normalizeMonitorChannelIndexes(
      options.processorOptions?.monitorChannelIndexes,
      this.channels
    )
    this.lowLatency = !!options.processorOptions?.lowLatency
    this.latencyMs = clampNumber(options.processorOptions?.latencyMs, 5, 500, 80)
    this.queue = []
    this.bufferedFrames = 0
    this.started = false
    this.updateBufferLimits()

    this.port.onmessage = (event) => {
      const {
        type,
        chunk,
        channels,
        latencyMs,
        lowLatency,
        outputMode,
        channelLabels,
        monitorChannelIndexes
      } = event.data || {}
      if (type === 'format') {
        this.channels = Math.max(1, Number(channels || this.channels))
        this.outputMode = normalizeOutputMode(outputMode || this.outputMode)
        this.channelLabels = normalizeChannelLabels(channelLabels, this.channels)
        this.monitorChannelIndexes = normalizeMonitorChannelIndexes(
          monitorChannelIndexes,
          this.channels
        )
        if (typeof lowLatency === 'boolean') {
          this.lowLatency = lowLatency
        }
        this.latencyMs = clampNumber(latencyMs, 5, 500, this.latencyMs)
        this.updateBufferLimits()
        this.queue = []
        this.bufferedFrames = 0
        this.started = false
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
    const requestedFrames = Math.floor((sampleRate * this.latencyMs) / 1000)
    this.targetBufferedFrames = this.lowLatency
      ? Math.max(512, Math.floor(sampleRate * 0.02), requestedFrames)
      : Math.max(128, requestedFrames)
    this.startBufferedFrames = this.lowLatency
      ? Math.max(256, Math.floor(sampleRate * 0.01))
      : this.targetBufferedFrames
    const extraFrames = this.lowLatency ? Math.floor(sampleRate * 0.04) : this.targetBufferedFrames
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
      if (!this.started) {
        if (this.bufferedFrames >= this.startBufferedFrames) {
          this.started = true
        } else {
          this.writeSilence(outputs, frame)
          continue
        }
      }

      const current = this.queue[0]
      if (!current) {
        this.started = false
        this.writeSilence(outputs, frame)
        continue
      }

      const base = current.frameOffset * this.channels
      if (this.outputMode === 'downmix' || this.outputMode === 'binaural') {
        const mixed = this.mixStereoFrame(current.samples, base)
        if (outputs[0]?.[0]) outputs[0][0][frame] = mixed.left
        if (outputs[1]?.[0]) outputs[1][0][frame] = mixed.right
      } else {
        for (let channel = 0; channel < outputs.length; channel += 1) {
          const output = outputs[channel]
          if (!output[0]) continue
          output[0][frame] = current.samples[base + channel] || 0
        }
      }

      current.frameOffset += 1
      this.bufferedFrames -= 1
      if (current.frameOffset >= current.frames) {
        this.queue.shift()
      }
    }

    return true
  }

  writeSilence(outputs, frame) {
    for (const output of outputs) {
      if (output[0]) output[0][frame] = 0
    }
  }

  mixStereoFrame(samples, base) {
    let left = 0
    let right = 0
    const master = this.outputMode === 'binaural' ? 0.35 : 0.707
    for (const channel of this.monitorChannelIndexes) {
      const sample = samples[base + channel] || 0
      const gains =
        this.outputMode === 'binaural'
          ? binauralGains(channel, this.channelLabels[channel], this.channels)
          : downmixGains(channel, this.channelLabels[channel], this.channels)
      left += sample * gains.left
      right += sample * gains.right
    }
    return {
      left: clampSample(left * master),
      right: clampSample(right * master)
    }
  }
}

function normalizeOutputMode(mode) {
  return ['downmix', 'binaural'].includes(mode) ? mode : 'discrete'
}

function normalizeChannelLabels(labels, channels) {
  return Array.from({ length: channels }, (_value, index) =>
    String(labels?.[index] || defaultLabel(index)).toUpperCase()
  )
}

function normalizeMonitorChannelIndexes(indexes, channels) {
  if (!Array.isArray(indexes) || indexes.length === 0) {
    return Array.from({ length: channels }, (_value, index) => index)
  }
  const normalized = indexes
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < channels)
  return normalized.length > 0
    ? [...new Set(normalized)]
    : Array.from({ length: channels }, (_value, index) => index)
}

function defaultLabel(index) {
  return ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BL', 'BR'][index] || (index % 2 ? 'FR' : 'FL')
}

function downmixGains(channel, label, totalChannels) {
  const value = normalizeLabel(label || defaultLabel(channel))
  const minus3db = 0.707
  if (['FL', 'L'].includes(value)) return { left: 1, right: 0 }
  if (['FR', 'R'].includes(value)) return { left: 0, right: 1 }
  if (['FC', 'C', 'LFE'].includes(value)) return { left: minus3db, right: minus3db }
  if (['SL', 'LS', 'BL', 'LSR', 'TFL', 'TBL'].includes(value)) return { left: minus3db, right: 0 }
  if (['SR', 'RS', 'BR', 'RSR', 'TFR', 'TBR'].includes(value)) return { left: 0, right: minus3db }
  if (totalChannels === 1) return { left: 1, right: 1 }
  return channel % 2 === 0 ? { left: 0.45, right: 0 } : { left: 0, right: 0.45 }
}

function binauralGains(channel, label, totalChannels) {
  const downmix = downmixGains(channel, label, totalChannels)
  const value = normalizeLabel(label || defaultLabel(channel))
  if (['FC', 'C', 'LFE'].includes(value)) return { left: 0.707, right: 0.707 }
  if (downmix.left > 0 && downmix.right === 0)
    return { left: downmix.left, right: downmix.left * 0.25 }
  if (downmix.right > 0 && downmix.left === 0)
    return { left: downmix.right * 0.25, right: downmix.right }
  return downmix
}

function normalizeLabel(label) {
  return String(label || '').toUpperCase()
}

function clampSample(sample) {
  if (!Number.isFinite(sample)) return 0
  return Math.max(-1, Math.min(1, sample))
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

registerProcessor('pcm-monitor-source', PcmMonitorSourceProcessor)
