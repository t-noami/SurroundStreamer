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
    return await this.runHelper(['--list-processes'])
  }

  async listOutputStreams() {
    return await this.runHelper(['--list-output-streams'])
  }

  async createTap(pid, options = {}, duration = 1) {
    return await this.runHelper([
      '--create-tap',
      '--pid',
      String(pid),
      '--duration',
      String(duration),
      ...this.buildStreamArgs(options)
    ])
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
