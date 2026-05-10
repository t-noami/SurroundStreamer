import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  startStream: (config) => ipcRenderer.invoke('stream:start', config),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  getStreamStatus: () => ipcRenderer.invoke('stream:status'),
  setMonitorActive: (isActive) => ipcRenderer.invoke('monitor:set-active', isActive),
  startFileMonitor: (config) => ipcRenderer.invoke('monitor:start-file', config),
  startInputDeviceMonitor: (config) => ipcRenderer.invoke('monitor:start-input-device', config),
  startNativeInputDeviceMonitor: (config) =>
    ipcRenderer.invoke('monitor:start-native-input-device', config),
  stopPreviewMonitor: () => ipcRenderer.invoke('monitor:stop-preview'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  getAudioBackendCapabilities: () => ipcRenderer.invoke('audio-backend:capabilities'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  probeAudio: (path) => ipcRenderer.invoke('media:probe-audio', path),
  ensureMicrophoneAccess: () => ipcRenderer.invoke('media:ensure-microphone-access'),
  openMicrophoneSettings: () => ipcRenderer.invoke('media:open-microphone-settings'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getLogs: () => ipcRenderer.invoke('logs:get'),
  addLogEntry: (payload) => ipcRenderer.invoke('logs:add', payload),
  onLogEntry: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('logs:entry', listener)
    return () => ipcRenderer.removeListener('logs:entry', listener)
  },
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
