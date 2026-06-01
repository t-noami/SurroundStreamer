const DEFAULT_CHANNEL_LABELS = [
  'FL',
  'FR',
  'FC',
  'LFE',
  'SL',
  'SR',
  'BL',
  'BR',
  'TFL',
  'TFR',
  'TBL',
  'TBR'
]

const SPEAKER_POSITIONS = {
  L: { x: -0.55, y: 0, z: -0.85, gain: 1 },
  R: { x: 0.55, y: 0, z: -0.85, gain: 1 },
  C: { x: 0, y: 0, z: -1, gain: 0.707 },
  FL: { x: -0.55, y: 0, z: -0.85, gain: 1 },
  FR: { x: 0.55, y: 0, z: -0.85, gain: 1 },
  FC: { x: 0, y: 0, z: -1, gain: 0.707 },
  LFE: { x: 0, y: -0.15, z: -1, gain: 0.707 },
  LS: { x: -0.95, y: 0, z: 0.15, gain: 0.707 },
  SL: { x: -0.95, y: 0, z: 0.15, gain: 0.707 },
  SR: { x: 0.95, y: 0, z: 0.15, gain: 0.707 },
  LSR: { x: -0.65, y: 0, z: 0.85, gain: 0.707 },
  RSR: { x: 0.65, y: 0, z: 0.85, gain: 0.707 },
  BL: { x: -0.65, y: 0, z: 0.85, gain: 0.707 },
  BR: { x: 0.65, y: 0, z: 0.85, gain: 0.707 },
  TFL: { x: -0.55, y: 0.75, z: -0.75, gain: 0.707 },
  TFR: { x: 0.55, y: 0.75, z: -0.75, gain: 0.707 },
  TBL: { x: -0.55, y: 0.75, z: 0.75, gain: 0.707 },
  TBR: { x: 0.55, y: 0.75, z: 0.75, gain: 0.707 }
}

const MONITOR_MASTER_GAIN = 0.707
const BINAURAL_MASTER_GAIN = 0.35

export class WebAudioMonitor {
  constructor(log = () => {}) {
    this.log = log
    this.context = null
    this.source = null
    this.destination = null
    this.outputElement = null
    this.deviceId = ''
    this.mode = 'stereo-pair'
    this.channels = 2
    this.channelLabels = DEFAULT_CHANNEL_LABELS.slice(0, 2)
    this.monitorChannelIndexes = [0, 1]
    this.pairStart = 0
    this.latencyMs = 80
    this.lowLatency = false
    this.directOutput = false
    this.volume = 1
    this.outputGain = null
    this.mediaStream = null
    this.mediaSource = null
    this.mediaProbe = null
    this.mediaProbeBuffer = null
    this.mediaProbeTimer = null
    this.onMediaPeaks = null
    this.pcmByteRemainder = null
    this.operation = Promise.resolve()
  }

  async start(format) {
    return this.enqueueOperation(() => this.startNow(format))
  }

  async startNow(format) {
    await this.stopNow()

    this.mode = normalizeMonitorMode(format.mode)
    this.channels = Math.max(1, Number(format.channels || 2))
    this.channelLabels = normalizeChannelLabels(format.channelLabels, this.channels)
    this.monitorChannelIndexes = normalizeMonitorChannelIndexes(
      format.monitorChannelIndexes,
      this.channels
    )
    this.pcmByteRemainder = null
    this.deviceId = format.deviceId || ''
    this.pairStart = clampInt(format.pairStart, 0, Math.max(0, this.channels - 1))
    this.lowLatency = !!format.lowLatency
    this.latencyMs = clampInt(format.latencyMs, 5, 500, 80)
    this.volume = clampNumber(format.volume, 0, 1, 1)

    this.directOutput = !!format.directOutput
    const workletOutputMode = shouldUseWorkletStereoMix(this.mode) ? this.mode : 'discrete'
    const workletOutputs = workletOutputMode === 'discrete' ? this.channels : 2

    const sampleRate = Number(format.sampleRate || 48000)
    const context = createMonitorAudioContext(sampleRate)
    this.context = context
    await context.audioWorklet.addModule(format.workletUrl || './monitor-worklet.js')

    this.source = new AudioWorkletNode(context, 'pcm-monitor-source', {
      numberOfInputs: 0,
      numberOfOutputs: workletOutputs,
      outputChannelCount: Array.from({ length: workletOutputs }, () => 1),
      processorOptions: {
        channels: this.channels,
        outputMode: workletOutputMode,
        channelLabels: this.channelLabels,
        monitorChannelIndexes: this.monitorChannelIndexes,
        latencyMs: this.latencyMs,
        lowLatency: this.lowLatency
      }
    })
    this.source.port.postMessage({
      type: 'format',
      channels: this.channels,
      outputMode: workletOutputMode,
      channelLabels: this.channelLabels,
      monitorChannelIndexes: this.monitorChannelIndexes,
      latencyMs: this.latencyMs,
      lowLatency: this.lowLatency
    })

    this.outputGain = context.createGain()
    this.outputGain.gain.value = this.volume

    if (workletOutputMode !== 'discrete') {
      this.connectRenderedStereoGraph()
    } else if (this.mode === 'binaural') {
      this.connectBinauralGraph()
    } else if (this.mode === 'downmix') {
      this.connectDownmixGraph()
    } else {
      this.connectStereoPairGraph()
    }

    await this.connectOutputPath()
    await context.resume()
    if (this.outputElement) {
      await this.outputElement.play()
    }
  }

  async startMediaStream(format, mediaStream) {
    return this.enqueueOperation(() => this.startMediaStreamNow(format, mediaStream))
  }

  async startMediaStreamNow(format, mediaStream) {
    await this.stopNow()

    this.mode = normalizeMonitorMode(format.mode)
    this.channels = Math.max(1, Number(format.channels || 2))
    this.channelLabels = normalizeChannelLabels(format.channelLabels, this.channels)
    this.monitorChannelIndexes = normalizeMonitorChannelIndexes(
      format.monitorChannelIndexes,
      this.channels
    )
    this.pcmByteRemainder = null
    this.deviceId = format.deviceId || ''
    this.pairStart = clampInt(format.pairStart, 0, Math.max(0, this.channels - 1))
    this.lowLatency = !!format.lowLatency
    this.latencyMs = clampInt(format.latencyMs, 5, 500, 80)
    this.volume = clampNumber(format.volume, 0, 1, 1)
    this.mediaStream = mediaStream

    this.directOutput = !!format.directOutput

    const sampleRate = Number(format.sampleRate || 48000)
    const context = createMonitorAudioContext(sampleRate)
    this.context = context
    this.mediaSource = context.createMediaStreamSource(mediaStream)

    this.outputGain = context.createGain()
    this.outputGain.gain.value = this.volume

    if (this.shouldUseDirectMediaGraph()) {
      this.mediaSource.connect(this.outputGain)
    } else {
      this.source = context.createChannelSplitter(this.channels)
      this.mediaSource.connect(this.source)
      if (this.mode === 'binaural') {
        this.connectBinauralGraph()
      } else if (this.mode === 'downmix') {
        this.connectDownmixGraph()
      } else {
        this.connectStereoPairGraph()
      }
    }

    if (typeof format.onPeaks === 'function') {
      this.connectMediaProbe(format.onPeaks)
    }

    await this.connectOutputPath()
    await context.resume()
    if (this.outputElement) {
      await this.outputElement.play()
    }
  }

  async setDevice(deviceId) {
    this.deviceId = deviceId || ''
    if (this.context && !this.outputElement && typeof this.context.setSinkId === 'function') {
      await this.context.setSinkId(this.deviceId)
      return
    }

    if (!this.outputElement || typeof this.outputElement.setSinkId !== 'function') {
      if (this.deviceId) {
        this.log('Monitor output device selection is not supported in this runtime.', 'error')
      }
      return
    }

    await this.outputElement.setSinkId(this.deviceId)
  }

  async connectOutputPath() {
    if (!this.context || !this.outputGain) return

    if (this.directOutput) {
      if (!this.deviceId || typeof this.context.setSinkId === 'function') {
        await this.setDevice(this.deviceId)
        this.outputGain.connect(this.context.destination)
        this.destination = this.context.destination
        return
      }
    }

    this.destination = this.context.createMediaStreamDestination()
    this.outputGain.connect(this.destination)
    this.outputElement = new Audio()
    this.outputElement.autoplay = true
    this.outputElement.srcObject = this.destination.stream
    await this.setDevice(this.deviceId)
  }

  shouldUseDirectMediaGraph() {
    return (
      this.directOutput && this.mode === 'stereo-pair' && this.pairStart === 0 && this.channels <= 2
    )
  }

  setVolume(volume) {
    this.volume = clampNumber(volume, 0, 1, this.volume)
    if (this.outputGain) {
      this.outputGain.gain.value = this.volume
    }
  }

  pushChunk(chunk) {
    if (!this.source || !this.source.port || !chunk) return

    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    const frameBytes = Math.max(4, this.channels * 4)
    let bytes = view

    if (this.pcmByteRemainder?.byteLength > 0) {
      bytes = new Uint8Array(this.pcmByteRemainder.byteLength + view.byteLength)
      bytes.set(this.pcmByteRemainder, 0)
      bytes.set(view, this.pcmByteRemainder.byteLength)
    }

    const usableLength = Math.floor(bytes.byteLength / frameBytes) * frameBytes
    if (usableLength <= 0) {
      this.pcmByteRemainder = bytes.slice()
      return
    }

    this.pcmByteRemainder =
      usableLength < bytes.byteLength ? bytes.slice(usableLength, bytes.byteLength) : null
    const alignedBytes = usableLength === bytes.byteLength ? bytes : bytes.slice(0, usableLength)
    const buffer = alignedBytes.buffer.slice(
      alignedBytes.byteOffset,
      alignedBytes.byteOffset + alignedBytes.byteLength
    )
    this.source.port.postMessage({ type: 'chunk', chunk: buffer }, [buffer])
  }

  async stop() {
    return this.enqueueOperation(() => this.stopNow())
  }

  async stopNow() {
    if (this.mediaProbeTimer) {
      clearInterval(this.mediaProbeTimer)
      this.mediaProbeTimer = null
    }

    if (this.mediaProbe) {
      this.mediaProbe.disconnect()
      this.mediaProbe = null
    }

    this.mediaProbeBuffer = null
    this.onMediaPeaks = null
    this.pcmByteRemainder = null

    if (this.mediaSource) {
      this.mediaSource.disconnect()
      this.mediaSource = null
    }

    if (this.source) {
      this.source.disconnect()
      this.source = null
    }

    if (this.outputElement) {
      this.outputElement.pause()
      this.outputElement.srcObject = null
      this.outputElement = null
    }

    if (this.context) {
      const context = this.context
      this.context = null
      await context.close().catch(() => {})
    }

    this.destination = null
    this.outputGain = null
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }
  }

  enqueueOperation(task) {
    const nextOperation = this.operation.catch(() => {}).then(task)
    this.operation = nextOperation.catch(() => {})
    return nextOperation
  }

  connectStereoPairGraph() {
    const merger = this.context.createChannelMerger(2)
    const leftIndex = Math.min(this.pairStart, this.channels - 1)
    const rightIndex = Math.min(leftIndex + 1, this.channels - 1)
    this.source.connect(merger, leftIndex, 0)
    this.source.connect(merger, rightIndex, 1)
    merger.connect(this.outputGain)
  }

  connectRenderedStereoGraph() {
    const merger = this.context.createChannelMerger(2)
    this.source.connect(merger, 0, 0)
    this.source.connect(merger, 1, 1)
    merger.connect(this.outputGain)
  }

  connectMediaProbe(onPeaks) {
    this.onMediaPeaks = onPeaks
    this.mediaProbe = this.context.createAnalyser()
    this.mediaProbe.fftSize = 2048
    this.mediaProbeBuffer = new Float32Array(this.mediaProbe.fftSize)
    this.mediaSource.connect(this.mediaProbe)
    this.mediaProbeTimer = setInterval(() => this.emitMediaProbePeaks(), 100)
  }

  emitMediaProbePeaks() {
    if (!this.mediaProbe || !this.mediaProbeBuffer || !this.onMediaPeaks) return

    this.mediaProbe.getFloatTimeDomainData(this.mediaProbeBuffer)
    let peak = 0
    for (const sample of this.mediaProbeBuffer) {
      const abs = Math.abs(sample)
      if (abs > peak) peak = abs
    }
    const db = peak <= 0 ? -120 : 20 * Math.log10(peak)
    this.onMediaPeaks({
      channels: 2,
      peaks: {
        0: db,
        1: db
      }
    })
  }

  connectDownmixGraph() {
    const merger = this.context.createChannelMerger(2)
    const master = this.context.createGain()
    master.gain.value = MONITOR_MASTER_GAIN
    merger.connect(master)
    master.connect(this.outputGain)

    for (const channel of this.monitorChannelIndexes) {
      const { left, right } = downmixGains(channel, this.channels, this.channelLabels[channel])
      if (left > 0) {
        const gain = this.context.createGain()
        gain.gain.value = left
        this.source.connect(gain, channel, 0)
        gain.connect(merger, 0, 0)
      }
      if (right > 0) {
        const gain = this.context.createGain()
        gain.gain.value = right
        this.source.connect(gain, channel, 0)
        gain.connect(merger, 0, 1)
      }
    }
  }

  connectBinauralGraph() {
    const master = this.context.createGain()
    master.gain.value = BINAURAL_MASTER_GAIN

    master.connect(this.outputGain)

    for (const channel of this.monitorChannelIndexes) {
      const label = this.channelLabels[channel]
      const position = speakerPositionFor(label, channel, this.channels)
      const gain = this.context.createGain()
      gain.gain.value = position.gain

      this.source.connect(gain, channel, 0)

      const panner = this.context.createPanner()
      panner.panningModel = 'HRTF'
      panner.distanceModel = 'inverse'
      panner.refDistance = 1
      panner.maxDistance = 30
      panner.rolloffFactor = 0.18
      panner.coneInnerAngle = 360
      panner.coneOuterAngle = 360
      setPannerPosition(panner, position.x, position.y, position.z)

      if (isLfeLabel(label)) {
        const lfeFilter = this.context.createBiquadFilter()
        lfeFilter.type = 'lowpass'
        lfeFilter.frequency.value = 120
        lfeFilter.Q.value = 0.707
        gain.connect(lfeFilter)
        lfeFilter.connect(panner)
      } else {
        gain.connect(panner)
      }
      panner.connect(master)
    }
  }
}

function normalizeMonitorMode(mode) {
  if (mode === 'stereo') return 'stereo-pair'
  return mode || 'stereo-pair'
}

function shouldUseWorkletStereoMix(mode) {
  return mode === 'downmix' || mode === 'binaural'
}

function createMonitorAudioContext(sampleRate) {
  return new AudioContext({ sampleRate })
}

function normalizeChannelLabels(labels, channels) {
  return Array.from({ length: channels }, (_value, index) => {
    const label = labels?.[index] || DEFAULT_CHANNEL_LABELS[index] || `CH${index + 1}`
    return String(label).toUpperCase()
  })
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

function downmixGains(channel, totalChannels, label = null) {
  if (totalChannels === 1) {
    return { left: 1, right: 1 }
  }

  const labelGains = downmixGainsForLabel(label)
  if (labelGains) return labelGains

  const minus3db = 0.707
  const matrix = [
    { left: 1, right: 0 },
    { left: 0, right: 1 },
    { left: minus3db, right: minus3db },
    { left: minus3db, right: minus3db },
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

function downmixGainsForLabel(label) {
  const value = String(label || '').toUpperCase()
  if (!value) return null

  const minus3db = 0.707
  if (['L', 'FL'].includes(value)) return { left: 1, right: 0 }
  if (['R', 'FR'].includes(value)) return { left: 0, right: 1 }
  if (['C', 'FC', 'LFE'].includes(value)) return { left: minus3db, right: minus3db }
  if (['LS', 'SL', 'LSR', 'BL', 'TFL', 'TBL'].includes(value)) {
    return { left: minus3db, right: 0 }
  }
  if (['RS', 'SR', 'RSR', 'BR', 'TFR', 'TBR'].includes(value)) {
    return { left: 0, right: minus3db }
  }

  return null
}

function fallbackPosition(index, total) {
  const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2
  return {
    x: Math.cos(angle),
    y: 0,
    z: Math.sin(angle),
    gain: 0.7
  }
}

function speakerPositionFor(label, index, total) {
  return SPEAKER_POSITIONS[label] || fallbackPosition(index, total)
}

function isLfeLabel(label) {
  return String(label || '').toUpperCase() === 'LFE'
}

function setPannerPosition(panner, x, y, z) {
  if (panner.positionX) {
    panner.positionX.value = x
    panner.positionY.value = y
    panner.positionZ.value = z
    return
  }

  panner.setPosition(x, y, z)
}

function clampInt(value, min, max, fallback = min) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

function clampNumber(value, min, max, fallback = min) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}
