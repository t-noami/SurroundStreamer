import { ipcMain, dialog, BrowserWindow } from 'electron'
import ffmpegManager from './ffmpeg-manager'
import deviceScanner from './device-scanner'

export function setupIpcHandlers() {
  ffmpegManager.on('log', (payload) => {
    eventSendAll('ffmpeg:log', payload)
  })

  ffmpegManager.on('status', (status) => {
    eventSendAll('stream:status-update', status)
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

  ipcMain.handle('devices:list', async () => {
    return await deviceScanner.listAudioDevices()
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
