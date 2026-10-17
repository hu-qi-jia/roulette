const { app } = require('electron')
const { spawn } = require('child_process')
const readline = require('readline')
const path = require('path')

const exe = path.join(__dirname, '..', 'native', 'mouse-hook', 'target', 'release', 'roulette-hook.exe')
const target = process.env.TARGET_HWND || process.argv[2]

let proc = null

app.whenReady().then(() => {
  console.log('[test] spawning hook, target hwnd =', target)
  proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] })

  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity })
  rl.on('line', (line) => {
    console.log('[hook]', line)
    if (line.includes('"ready"')) {
      setTimeout(() => {
        console.log('[test] sending paste')
        proc.stdin.write(`paste ${target}\n`)
      }, 1500)
    }
  })

  proc.stderr.on('data', (data) => console.log('[hook stderr]', data.toString().trim()))
  proc.on('exit', (code) => console.log('[test] hook exited', code))

  setTimeout(() => {
    if (proc) proc.kill()
    app.quit()
  }, 7000)
})
