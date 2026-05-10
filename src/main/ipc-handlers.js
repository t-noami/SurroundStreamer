import { ipcMain, dialog, BrowserWindow } from 'electron'
import ffmpegManager from './ffmpeg-manager'
import audioBackend from './audio-backends'
import mediaProber from './media-prober'
import logStore from './log-store'

export function setupIpcHandlers() {
  ffmpegManager.on('log', (payload) => {
    const entry = logStore.append(payload)
    if (entry) eventSendAll('ffmpeg:log', entry)
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

  ipcMain.handle('monitor:start-file', (_event, config) => {
    try {
      ffmpegManager.startFileMonitor(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('monitor:start-input-device', (_event, config) => {
    try {
      ffmpegManager.startInputDeviceMonitor(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('monitor:start-native-input-device', (_event, config) => {
    try {
      ffmpegManager.startNativeInputDeviceMonitor(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('monitor:stop-preview', () => {
    ffmpegManager.stopPreviewMonitor()
    return { success: true }
  })

  ipcMain.handle('devices:list', async () => {
    return await audioBackend.listInputDevices()
  })

  ipcMain.handle('audio-backend:capabilities', () => {
    return audioBackend.getCapabilities()
  })

  ipcMain.handle('media:probe-audio', async (_event, path) => {
    return await mediaProber.probeAudio(path)
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

  ipcMain.handle('logs:get', () => {
    return logStore.getEntries()
  })

  ipcMain.handle('logs:add', (_event, payload) => {
    return logStore.append(payload)
  })
}

function eventSendAll(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
