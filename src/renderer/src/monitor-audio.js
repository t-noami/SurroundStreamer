const HRTF_POSITIONS = [
  { x: -0.55, y: 0, z: -0.85, gain: 1 },
  { x: 0.55, y: 0, z: -0.85, gain: 1 },
  { x: 0, y: 0, z: -1, gain: 0.8 },
  { x: 0, y: 0, z: 0, gain: 0.25 },
  { x: -0.95, y: 0, z: 0.25, gain: 0.85 },
  { x: 0.95, y: 0, z: 0.25, gain: 0.85 },
  { x: -0.65, y: 0, z: 0.85, gain: 0.75 },
  { x: 0.65, y: 0, z: 0.85, gain: 0.75 }
]

export class WebAudioMonitor {
  constructor(log = () => {}) {
    this.log = log
    this.context = null
    this.source = null
    this.destination = null
    this.outputElement = null
    this.deviceId = ''
    this.mode = 'stereo'
    this.channels = 2
    this.workletReady = false
  }

  async start(format) {
    await this.stop()

    this.mode = format.mode || 'stereo'
    this.channels = Math.max(1, Number(format.channels || 2))
    this.deviceId = format.deviceId || ''

    const sampleRate = Number(format.sampleRate || 48000)
    this.context = new AudioContext({ sampleRate })
    await this.context.audioWorklet.addModule('./monitor-worklet.js')

    this.source = new AudioWorkletNode(this.context, 'pcm-monitor-source', {
      numberOfInputs: 0,
      numberOfOutputs: this.channels,
      outputChannelCount: Array.from({ length: this.channels }, () => 1),
      processorOptions: { channels: this.channels }
    })
    this.source.port.postMessage({ type: 'format', channels: this.channels })

    this.destination = this.context.createMediaStreamDestination()
    if (this.mode === 'binaural') {
      this.connectBinauralGraph()
    } else {
      this.connectStereoGraph()
    }

    this.outputElement = new Audio()
    this.outputElement.autoplay = true
    this.outputElement.srcObject = this.destination.stream
    await this.setDevice(this.deviceId)
    await this.context.resume()
    await this.outputElement.play()
  }

  async setDevice(deviceId) {
    this.deviceId = deviceId || ''
    if (!this.outputElement || typeof this.outputElement.setSinkId !== 'function') {
      if (this.deviceId) {
        this.log('Monitor output device selection is not supported in this runtime.', 'error')
      }
      return
    }

    await this.outputElement.setSinkId(this.deviceId)
  }

  pushChunk(chunk) {
    if (!this.source || !chunk) return

    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    this.source.port.postMessage({ type: 'chunk', chunk: buffer }, [buffer])
  }

  async stop() {
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
  }

  connectStereoGraph() {
    const merger = this.context.createChannelMerger(2)
    this.source.connect(merger, 0, 0)
    this.source.connect(merger, this.channels > 1 ? 1 : 0, 1)
    merger.connect(this.destination)
  }

  connectBinauralGraph() {
    const master = this.context.createGain()
    master.gain.value = 0.85
    master.connect(this.destination)

    for (let channel = 0; channel < this.channels; channel += 1) {
      const position = HRTF_POSITIONS[channel] || fallbackPosition(channel, this.channels)
      const gain = this.context.createGain()
      gain.gain.value = position.gain

      const panner = this.context.createPanner()
      panner.panningModel = 'HRTF'
      panner.distanceModel = 'inverse'
      panner.refDistance = 1
      panner.maxDistance = 10000
      panner.rolloffFactor = 0
      setPannerPosition(panner, position.x, position.y, position.z)

      this.source.connect(gain, channel, 0)
      gain.connect(panner)
      panner.connect(master)
    }
  }
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

function setPannerPosition(panner, x, y, z) {
  if (panner.positionX) {
    panner.positionX.value = x
    panner.positionY.value = y
    panner.positionZ.value = z
    return
  }

  panner.setPosition(x, y, z)
}
