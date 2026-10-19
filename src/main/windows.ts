import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import type { WheelMode } from '../shared/types'

export const OVERLAY_SIZE = 420
export const BUBBLE_SIZE = 64

type Route = 'overlay' | 'panel' | 'shot' | 'drag' | 'bubble'

function appIconPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, 'resources', 'icon.png')
}

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
      sandbox: false,
      // Keep rAF running while the window is hidden so the renderer can
      // commit a frame before we map it.
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  loadRoute(win, 'overlay')
  return win
}

export function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 420,
    minHeight: 420,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  // Windows 11 can still attach a DWM shadow to frameless transparent
  // windows even with hasShadow: false in the constructor.
  win.setHasShadow(false)
  win.setAlwaysOnTop(true, 'floating')
  loadRoute(win, 'panel')
  return win
}

/** A small click-through preview that follows the cursor while text is being
 *  dragged out of the panel. It never takes focus. */
export function createDragWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 104,
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
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.setHasShadow(false)
  loadRoute(win, 'drag')
  return win
}

/** A small always-on-top launcher that can be dragged around the desktop. */
export function createBubbleWindow(at: { x: number; y: number }): BrowserWindow {
  const win = new BrowserWindow({
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    x: Math.round(at.x),
    y: Math.round(at.y),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    alwaysOnTop: true,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setHasShadow(false)
  loadRoute(win, 'bubble')
  return win
}

export function createShotWindow(): BrowserWindow {  const win = new BrowserWindow({
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
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
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
