// A Chromium-style drop target for manual drag tests. It writes the textarea
// value to out/html-target.txt so the PowerShell driver can verify a paste.
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const output = path.join(root, 'out', 'html-target.txt')
const url =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    `<!doctype html><html><body style="margin:0;background:#fff">
      <textarea id="t" placeholder="Drop here"
        style="position:absolute;inset:0;width:100%;height:100%;padding:12px;border:0;outline:0;font:16px Consolas;resize:none"></textarea>
      <script>
        window.__events = [];
        const t = document.getElementById('t');
        const log = (name) => window.__events.push(name + '@' + Date.now());
        for (const type of ['mousedown', 'mouseup', 'click', 'focus', 'blur', 'input']) {
          t.addEventListener(type, () => log('t:' + type));
          window.addEventListener(type, () => log('w:' + type), true);
        }
      </script>
    </body></html>`
  )

app.whenReady().then(() => {
  const target = new BrowserWindow({
    x: 40,
    y: 120,
    width: 700,
    height: 340,
    title: 'Roulette HTML Target',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  void target.loadURL(url)
  target.webContents.on('did-finish-load', () => {
    target.focus()
    void target.webContents.executeJavaScript("document.getElementById('t').focus()")
    console.log('[target] ready')
    // Make sure the drop target is not the foreground window when the drag
    // starts; the panel/launcher will be foreground instead.
    setTimeout(() => {
      const distraction = new BrowserWindow({
        x: 800,
        y: 120,
        width: 320,
        height: 200,
        title: 'Roulette Distraction'
      })
      void distraction.loadURL('data:text/html,<h2 style="font-family:sans-serif">background window</h2>')
      distraction.once('ready-to-show', () => distraction.focus())
    }, 1000)
  })

  setInterval(() => {
    if (target.isDestroyed()) return
    target.webContents
      .executeJavaScript(
        `JSON.stringify({
          value: document.getElementById('t')?.value ?? '',
          active: document.activeElement?.id || document.activeElement?.tagName || '',
          events: window.__events || []
        })`
      )
      .then((raw) => {
        const state = JSON.parse(raw)
        fs.writeFileSync(
          output,
          JSON.stringify({
            value: state.value,
            active: state.active,
            events: state.events.slice(-20)
          })
        )
      })
      .catch(() => {})
  }, 200)
})
