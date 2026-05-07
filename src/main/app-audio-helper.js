import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, resolve } from 'path'

class AppAudioHelper {
  getHelperPath() {
    const packagedPath = join(process.resourcesPath, 'audio-tap-helper')
    if (app.isPackaged && existsSync(packagedPath)) {
      return packagedPath
    }

    return resolve(process.cwd(), 'native/audio-tap-helper/.build/AudioTapHelper')
  }

  async listProcesses() {
    const result = await this.runHelper(['--list-processes'])
    return {
      ...result,
      processes: (result.processes || []).filter((process) => this.isUserFacingProcess(process))
    }
  }

  isUserFacingProcess(process) {
    if (process.isRegularApp) return true
    if (process.isRegularApp === false) return false

    const name = String(process.name || '')
    const bundleID = String(process.bundleID || '')
    if (!name || name.startsWith('PID ')) return false
    if (bundleID.startsWith('com.apple.audio') || bundleID.startsWith('com.apple.CoreAudio')) {
      return false
    }
    return true
  }

  async listInputStreams() {
    return await this.runHelper(['--list-input-streams'])
  }

  async listOutputStreams() {
    return await this.runHelper(['--list-output-streams'])
  }

  spawnPCMStream(pid, options = {}) {
    const helperPath = this.getHelperPath()
    if (!existsSync(helperPath)) {
      throw new Error(`Audio tap helper not found: ${helperPath}`)
    }

    return spawn(
      helperPath,
      ['--stream-pcm', '--pid', String(pid), ...this.buildStreamArgs(options)],
      {
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
  }

  spawnInputDevicePCMStream(options = {}) {
    const helperPath = this.getHelperPath()
    if (!existsSync(helperPath)) {
      throw new Error(`Audio tap helper not found: ${helperPath}`)
    }

    if (!options.deviceUID) {
      throw new Error('Input device PCM stream requires a Core Audio device UID')
    }

    const args = ['--stream-input-device', '--device-uid', String(options.deviceUID)]
    if (options.streamIndex !== undefined && options.streamIndex !== null) {
      args.push('--stream-index', String(options.streamIndex))
    }

    return spawn(helperPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }

  buildStreamArgs(options) {
    if (!options.deviceUID || options.streamIndex === undefined || options.streamIndex === null) {
      return []
    }

    return [
      '--device-uid',
      String(options.deviceUID),
      '--stream-index',
      String(options.streamIndex)
    ]
  }

  runHelper(args) {
    return new Promise((resolvePromise, reject) => {
      const helperPath = this.getHelperPath()
      if (!existsSync(helperPath)) {
        reject(new Error(`Audio tap helper not found: ${helperPath}`))
        return
      }

      const child = spawn(helperPath, args)
      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('error', reject)

      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(stderr.trim() || stdout.trim() || `Audio tap helper exited with code ${code}`)
          )
          return
        }

        try {
          resolvePromise(JSON.parse(stdout))
        } catch (error) {
          reject(new Error(`Invalid audio tap helper JSON: ${error.message}`))
        }
      })
    })
  }
}

export default new AppAudioHelper()
