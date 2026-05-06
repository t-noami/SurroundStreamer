import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  startStream: (config) => ipcRenderer.invoke('stream:start', config),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  getStreamStatus: () => ipcRenderer.invoke('stream:status'),
  setMonitorActive: (isActive) => ipcRenderer.invoke('monitor:set-active', isActive),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  listAppAudioProcesses: () => ipcRenderer.invoke('app-audio:list-processes'),
  listAppAudioOutputStreams: () => ipcRenderer.invoke('app-audio:list-output-streams'),
  createAppAudioTap: (payload) => ipcRenderer.invoke('app-audio:create-tap', payload),
  onFfmpegLog: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ffmpeg:log', listener)
    return () => ipcRenderer.removeListener('ffmpeg:log', listener)
  },
  onStreamStatus: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('stream:status-update', listener)
    return () => ipcRenderer.removeListener('stream:status-update', listener)
  },
  onStreamMeter: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('stream:meter', listener)
    return () => ipcRenderer.removeListener('stream:meter', listener)
  },
  onMonitorFormat: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('monitor:format', listener)
    return () => ipcRenderer.removeListener('monitor:format', listener)
  },
  onMonitorAudio: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('monitor:audio', listener)
    return () => ipcRenderer.removeListener('monitor:audio', listener)
  },
  onMonitorStop: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('monitor:stop', listener)
    return () => ipcRenderer.removeListener('monitor:stop', listener)
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
