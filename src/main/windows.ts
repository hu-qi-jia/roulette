import { BrowserWindow } from 'electron'
import path from 'node:path'
import type { WheelMode } from '../shared/types'

export const OVERLAY_SIZE = 420

type Route = 'overlay' | 'panel' | 'shot'

function loadRoute(win: BrowserWindow, route: Route): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(devUrl)
    url.searchParams.set('window', route)
    void win.loadURL(url.toString())
    return
  }
  void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
    search: `window=${route}`
  })
}

export function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  loadRoute(win, 'overlay')
  return win
}

export function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 660,
    minWidth: 420,
    minHeight: 420,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  // Windows 11 can still attach a DWM shadow to frameless transparent
  // windows even with hasShadow: false in the constructor.
  win.setHasShadow(false)
  win.setAlwaysOnTop(true, 'floating')
  loadRoute(win, 'panel')
  return win
}

export function createShotWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setMenuBarVisibility(false)
  loadRoute(win, 'shot')
  return win
}

export function setOverlayInteractive(win: BrowserWindow, mode: WheelMode): void {
  if (mode === 'click') {
    win.setFocusable(true)
    win.setIgnoreMouseEvents(false)
  } else {
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setFocusable(false)
  }
}
