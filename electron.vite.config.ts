import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    build: {
      // electron-vite defaults minify to false; the unminified renderer bundle
      // is parsed by three windows at startup.
      minify: 'oxc'
    }
  }
})
