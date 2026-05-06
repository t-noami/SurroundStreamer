import { ipcMain, dialog, BrowserWindow } from 'electron'
import ffmpegManager from './ffmpeg-manager'
import deviceScanner from './device-scanner'
import appAudioHelper from './app-audio-helper'

export function setupIpcHandlers() {
  ffmpegManager.on('log', (payload) => {
    eventSendAll('ffmpeg:log', payload)
  })

  ffmpegManager.on('status', (status) => {
    eventSendAll('stream:status-update', status)
  })

  ffmpegManager.on('meter', (payload) => {
    eventSendAll('stream:meter', payload)
  })

  ffmpegManager.on('monitor-format', (payload) => {
    eventSendAll('monitor:format', payload)
  })

  ffmpegManager.on('monitor-audio', (payload) => {
    eventSendAll('monitor:audio', payload)
  })

  ffmpegManager.on('monitor-stop', () => {
    eventSendAll('monitor:stop')
  })

  ipcMain.handle('stream:start', async (event, config) => {
    try {
      await ffmpegManager.startStream(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('stream:stop', async () => {
    try {
      await ffmpegManager.stopStream()
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('stream:status', () => {
    return ffmpegManager.getStatus()
  })

  ipcMain.handle('monitor:set-active', (_event, isActive) => {
    ffmpegManager.setMonitorActive(isActive)
    return { success: true }
  })

  ipcMain.handle('devices:list', async () => {
    return await deviceScanner.listAudioDevices()
  })

  ipcMain.handle('app-audio:list-processes', async () => {
    return await appAudioHelper.listProcesses()
  })

  ipcMain.handle('app-audio:list-output-streams', async () => {
    return await appAudioHelper.listOutputStreams()
  })

  ipcMain.handle('app-audio:create-tap', async (_event, payload) => {
    if (typeof payload === 'number') {
      return await appAudioHelper.createTap(payload)
    }
    return await appAudioHelper.createTap(payload.pid, payload.options || {})
  })

  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'flac', 'opus', 'ogg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!canceled) {
      return filePaths[0]
    }
  })
}

function eventSendAll(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
