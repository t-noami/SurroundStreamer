import { app, shell, BrowserWindow, ipcMain, Menu, session, systemPreferences } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { setupIpcHandlers } from './ipc-handlers'
import ffmpegManager from './ffmpeg-manager'
import logStore from './log-store'

let mainWindow = null
let logWindow = null
let aboutWindow = null
let shutdownInProgress = false
let shutdownComplete = false

const GITHUB_REPOSITORY_URL = 'https://github.com/t-noami/SurroundStreamer'

function setupApplicationMenu() {
  if (process.platform !== 'darwin') {
    const template = [
      {
        label: 'File',
        submenu: [{ role: 'quit', label: 'Exit' }]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          {
            label: 'Show Logs',
            accelerator: 'CommandOrControl+L',
            click: () => createLogWindow()
          },
          { type: 'separator' },
          { role: 'minimize' },
          { role: 'close' }
        ]
      },
      {
        label: 'Help',
        submenu: [
          { label: 'GitHub Repository', click: () => openRepository() },
          { type: 'separator' },
          { label: `About ${app.getName()}`, click: () => createAboutWindow() }
        ]
      }
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    return
  }

  const appName = app.getName()
  const template = [
    {
      label: appName,
      submenu: [
        { label: `${appName}について`, click: () => createAboutWindow() },
        { type: 'separator' },
        { role: 'hide', label: `${appName}を隠す` },
        { role: 'hideOthers', label: 'ほかを隠す' },
        { role: 'unhide', label: 'すべてを表示' },
        { type: 'separator' },
        { role: 'quit', label: `${appName}を終了` }
      ]
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo', label: '取り消す' },
        { role: 'redo', label: 'やり直す' },
        { type: 'separator' },
        { role: 'cut', label: 'カット' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: 'ペースト' },
        { role: 'selectAll', label: 'すべてを選択' }
      ]
    },
    {
      label: 'ウインドウ',
      submenu: [
        {
          label: 'ログを表示',
          accelerator: 'CommandOrControl+L',
          click: () => createLogWindow()
        },
        { type: 'separator' },
        { role: 'minimize', label: 'しまう' },
        { role: 'close', label: '閉じる' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function sendLogEntryToWindows(entry) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('logs:entry', entry)
  }
}

function setupLogBroadcast() {
  logStore.on('entry', sendLogEntryToWindows)
}

function setupMediaPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture')
  })

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'audioCapture'
  })

  ipcMain.handle('media:ensure-microphone-access', async () => {
    if (process.platform !== 'darwin') {
      return { granted: true }
    }

    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') {
      return { granted: true, status }
    }

    if (status === 'denied' || status === 'restricted') {
      return { granted: false, status }
    }

    const granted = await systemPreferences.askForMediaAccess('microphone')
    return {
      granted,
      status: systemPreferences.getMediaAccessStatus('microphone')
    }
  })

  ipcMain.handle('media:open-microphone-settings', async () => {
    if (process.platform !== 'darwin') {
      return { success: false }
    }

    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    )
    return { success: true }
  })

  ipcMain.handle('app:info', () => ({
    name: 'SurroundStreamer',
    version: app.getVersion(),
    studio: 'Non-REM Studio',
    contact: 'info@non-rem.com',
    github: GITHUB_REPOSITORY_URL,
    copyright: 'Copyright (c) 2026 Non-REM Studio'
  }))
}

function setupWindowIpcHandlers() {
  ipcMain.handle('window:open-logs', () => {
    createLogWindow()
    return { success: true }
  })

  ipcMain.handle('window:open-about', () => {
    createAboutWindow()
    return { success: true }
  })

  ipcMain.handle('window:open-repository', async () => {
    await openRepository()
    return { success: true }
  })
}

function openRepository() {
  return shell.openExternal(GITHUB_REPOSITORY_URL)
}

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: process.platform === 'darwin',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', () => {
    if (logWindow && !logWindow.isDestroyed()) {
      logWindow.close()
    }
    if (aboutWindow && !aboutWindow.isDestroyed()) {
      aboutWindow.close()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.show()
    logWindow.focus()
    return
  }

  logWindow = new BrowserWindow({
    width: 780,
    height: 520,
    minWidth: 560,
    minHeight: 360,
    title: 'SurroundStreamer Logs',
    show: false,
    autoHideMenuBar: true,
    parent: mainWindow ?? undefined,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  logWindow.on('ready-to-show', () => {
    logWindow.show()
  })

  logWindow.on('closed', () => {
    logWindow = null
  })

  logWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    logWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/logs.html`)
  } else {
    logWindow.loadFile(join(__dirname, '../renderer/logs.html'))
  }
}

function createAboutWindow() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.show()
    aboutWindow.focus()
    return
  }

  aboutWindow = new BrowserWindow({
    width: 600,
    height: 640,
    minWidth: 520,
    minHeight: 560,
    title: 'About SurroundStreamer',
    show: false,
    autoHideMenuBar: true,
    parent: mainWindow ?? undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  aboutWindow.on('ready-to-show', () => {
    aboutWindow.show()
  })

  aboutWindow.on('closed', () => {
    aboutWindow = null
  })

  aboutWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    aboutWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/about.html`)
  } else {
    aboutWindow.loadFile(join(__dirname, '../renderer/about.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.surroundstreamer.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  setupMediaPermissions()
  setupIpcHandlers()
  setupWindowIpcHandlers()
  setupLogBroadcast()
  setupApplicationMenu()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// This app owns capture/streaming child processes, so closing the window should
// mean the whole app is ending.
app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', (event) => {
  if (shutdownComplete) {
    return
  }

  event.preventDefault()
  if (shutdownInProgress) {
    return
  }

  shutdownInProgress = true
  ffmpegManager
    .shutdown()
    .catch((error) => {
      console.error('Failed to stop streaming processes during app quit:', error)
    })
    .finally(() => {
      shutdownComplete = true
      app.quit()
    })
})

process.on('exit', () => {
  void ffmpegManager.shutdown()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
