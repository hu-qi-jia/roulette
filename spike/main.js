const { app, BrowserWindow, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const SIZE = 420;
const DEAD_ZONE = 36;

let win = null;
let hook = null;
let active = false;
let rendererReady = false;
let center = { x: 0, y: 0 };
let hideTimer = null;

function createOverlay() {
  win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    console.log('renderer ready');
  });
}

function hookPath() {
  const name = process.platform === 'win32' ? 'roulette-hook.exe' : 'roulette-hook';
  return path.join(__dirname, 'hook', 'target', 'release', name);
}

function startHook() {
  hook = spawn(hookPath(), [], { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: hook.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      console.log('[hook raw]', line);
      return;
    }
    handleHookEvent(ev);
  });
  hook.stderr.on('data', (d) => console.error('[hook:stderr]', d.toString().trim()));
  hook.on('error', (e) => console.error('[hook:spawn]', e));
  hook.on('exit', (code, sig) => console.log('[hook:exit]', code, sig));
}

function toDip(x, y) {
  if (typeof screen.screenToDipPoint === 'function') {
    try {
      const p = screen.screenToDipPoint({ x, y });
      return { x: p.x, y: p.y };
    } catch {}
  }
  const d = screen.getDisplayNearestPoint({ x, y });
  const sf = d.scaleFactor || 1;
  return { x: x / sf, y: y / sf };
}

function sectorForAngle(angle) {
  if (angle >= 210 && angle < 330) return 'text';
  if (angle >= 90 && angle < 210) return 'screenshot';
  return 'voice';
}

function handleHookEvent(ev) {
  switch (ev.type) {
    case 'ready':
      console.log('HOOK READY — hold Alt, then hold the right mouse button');
      break;

    case 'down': {
      active = true;
      const p = toDip(ev.x, ev.y);
      center = p;
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      win.setBounds({
        x: Math.round(p.x - SIZE / 2),
        y: Math.round(p.y - SIZE / 2),
        width: SIZE,
        height: SIZE
      });
      win.showInactive();
      if (rendererReady) win.webContents.send('wheel:show');
      // Spike-only: capture the overlay so the wheel can be inspected offscreen.
      setTimeout(() => {
        win.webContents
          .capturePage()
          .then((img) => {
            fs.writeFileSync(path.join(__dirname, 'wheel-capture.png'), img.toPNG());
          })
          .catch(() => {});
      }, 200);
      break;
    }

    case 'move': {
      if (!active || !rendererReady) break;
      const p = toDip(ev.x, ev.y);
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dist = Math.hypot(dx, dy);
      const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      win.webContents.send('wheel:move', { angle, dist });
      break;
    }

    case 'up': {
      if (!active) break;
      active = false;
      const p = toDip(ev.x, ev.y);
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dist = Math.hypot(dx, dy);
      let result = 'cancel';
      if (dist >= DEAD_ZONE) {
        const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        result = sectorForAngle(angle);
      }
      console.log('SELECTED:', result, `(dist ${dist.toFixed(1)}px)`);
      if (rendererReady) win.webContents.send('wheel:result', { result });
      hideTimer = setTimeout(() => {
        if (!active) win.hide();
      }, 450);
      break;
    }
  }
}

app.whenReady().then(() => {
  createOverlay();
  startHook();
});

app.on('before-quit', () => {
  if (hook) {
    try {
      hook.kill();
    } catch {}
  }
});

app.on('window-all-closed', () => {
  // Keep running even if the overlay is closed.
});
