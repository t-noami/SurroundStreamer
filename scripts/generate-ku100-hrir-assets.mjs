import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import vm from 'vm'

const sourcePath = resolve('src/renderer/src/ku100-near-hrir.js')
const outputDir = resolve('resources/ku100-hrir')
const source = readFileSync(sourcePath, 'utf8').replace(
  'export const KU100_NEAR_HRIR =',
  'globalThis.KU100_NEAR_HRIR ='
)
const context = {}
vm.runInNewContext(source, context, { filename: sourcePath })

const hrir = context.KU100_NEAR_HRIR
if (!hrir?.responses || !Number.isInteger(hrir.sampleRate)) {
  throw new Error(`Could not read KU100 HRIR data from ${sourcePath}`)
}

mkdirSync(outputDir, { recursive: true })

const aliases = {
  L: 'FL',
  R: 'FR',
  C: 'FC',
  LS: 'SL',
  RS: 'SR',
  LSR: 'BL',
  RSR: 'BR'
}

const labels = Array.from(
  new Set([...Object.keys(hrir.responses), 'LFE', ...Object.values(aliases)])
)
for (const label of labels) {
  const response = hrir.responses[label] || hrir.responses[aliases[label]]
  const path = resolve(outputDir, `${label}.wav`)
  if (!response) {
    writeStereoWav(path, hrir.sampleRate, new Float32Array(128), new Float32Array(128))
    continue
  }
  writeStereoWav(
    path,
    hrir.sampleRate,
    Float32Array.from(response.left),
    Float32Array.from(response.right)
  )
}

function writeStereoWav(path, sampleRate, left, right) {
  mkdirSync(dirname(path), { recursive: true })
  const frames = Math.max(left.length, right.length)
  const dataBytes = frames * 2 * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(2, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2 * 2, 28)
  buffer.writeUInt16LE(2 * 2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)

  for (let index = 0; index < frames; index += 1) {
    buffer.writeInt16LE(floatToInt16(left[index] || 0), 44 + index * 4)
    buffer.writeInt16LE(floatToInt16(right[index] || 0), 44 + index * 4 + 2)
  }

  writeFileSync(path, buffer)
}

function floatToInt16(value) {
  const clamped = Math.max(-1, Math.min(1, Number(value) || 0))
  return Math.round(clamped * 32767)
}
