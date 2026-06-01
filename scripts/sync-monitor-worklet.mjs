import { copyFileSync } from 'fs'
import { resolve } from 'path'

const source = resolve('src/renderer/src/monitor-worklet.js')
const target = resolve('src/renderer/public/monitor-worklet.js')

copyFileSync(source, target)
