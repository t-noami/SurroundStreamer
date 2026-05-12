import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Inline a minimal getFfmpegPath stub by rewriting the import to a data: URL.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = resolve(repoRoot, 'src/main/audio-backends/linux-pipewire.js')
const original = readFileSync(SRC, 'utf8')
const stubURL = 'data:text/javascript,export function getFfmpegPath(){return "/usr/bin/ffmpeg"}'
const rewritten = original.replace(
  "import { getFfmpegPath } from '../ffmpeg-path'",
  `import { getFfmpegPath } from '${stubURL}'`
)
const SHIM = '/tmp/linux-pipewire-shim.mjs'
writeFileSync(SHIM, rewritten)

const { default: backend } = await import(SHIM)

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('close', () => resolve(out))
  })
}

const json = await run('pactl', ['-f', 'json', 'list', 'sources'])
const sources = JSON.parse(json)

console.log(`pactl reports ${sources.length} source(s)\n`)

for (let i = 0; i < sources.length; i++) {
  const src = sources[i]
  const device = backend.pulseSourceToDevice(src, i)
  console.log(`--- raw pactl ---`)
  console.log(`  name                 : ${src.name}`)
  console.log(`  sample_specification : ${src.sample_specification}`)
  console.log(`  channel_map          : ${src.channel_map}`)
  console.log(`  monitor_source       : ${src.monitor_source}`)
  console.log(`  audio.channels       : ${src.properties?.['audio.channels']}`)
  console.log(`--- fixed backend output ---`)
  console.log(`  display name      : ${device.name}`)
  console.log(`  sampleRate        : ${device.sampleRate}`)
  console.log(`  channels          : ${device.channels}`)
  console.log(`  bitsPerChannel    : ${device.bitsPerChannel}`)
  console.log(`  isLikelyLoopback  : ${device.isLikelyLoopback}`)
  console.log()
}

// Synthetic 5.1 case to prove multichannel works now (previously fell back to 2ch).
console.log('=== Synthetic 5.1 source (regression check) ===')
const fake51 = {
  name: 'fake_5_1_capture',
  description: 'Fake 5.1 Mic Array',
  sample_specification: 's24le 6ch 48000Hz',
  channel_map: 'front-left,front-right,front-center,lfe,rear-left,rear-right',
  properties: { 'audio.channels': '6' }
}
const fakeDev = backend.pulseSourceToDevice(fake51, 99)
console.log(`  channels   : ${fakeDev.channels}   (expect 6)`)
console.log(`  sampleRate : ${fakeDev.sampleRate} (expect 48000)`)

console.log('\n=== Synthetic mono source ===')
const fakeMono = {
  name: 'fake_mono_capture',
  description: 'Fake Mono Mic',
  sample_specification: 's16le 1ch 44100Hz',
  channel_map: 'mono',
  properties: { 'audio.channels': '1' }
}
const monoDev = backend.pulseSourceToDevice(fakeMono, 100)
console.log(`  channels   : ${monoDev.channels}   (expect 1)`)
console.log(`  sampleRate : ${monoDev.sampleRate} (expect 44100)`)

// Text-format fallback regression: drive the backend's own runCommand so LANG=C kicks in.
console.log('\n=== Text-format fallback (via backend.runCommand) ===')
const textResult = await backend.runCommand('pactl', ['list', 'sources'])
const textDevices = backend.parsePulseTextSources(textResult.stdout)
console.log(`  parsed ${textDevices.length} device(s) from text format`)
for (const d of textDevices) {
  console.log(
    `  - ${d.name} : ${d.channels}ch @ ${d.sampleRate}Hz   loopback=${d.isLikelyLoopback}`
  )
}
