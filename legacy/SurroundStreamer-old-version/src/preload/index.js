import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  startStream: (config) => ipcRenderer.invoke('stream:start', config),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  getStreamStatus: () => ipcRenderer.invoke('stream:status'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  onFfmpegLog: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ffmpeg:log', listener)
    return () => ipcRenderer.removeListener('ffmpeg:log', listener)
  },
  onStreamStatus: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('stream:status-update', listener)
    return () => ipcRenderer.removeListener('stream:status-update', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
