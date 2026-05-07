import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          logs: resolve('src/renderer/logs.html'),
          about: resolve('src/renderer/about.html')
        }
      }
    }
  }
})
