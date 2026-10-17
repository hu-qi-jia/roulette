import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createInterface } from 'node:readline'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import type { HookEvent } from '../shared/types'

export class HookClient extends EventEmitter {
  private proc: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private stopping = false
  private waiters: {
    match: (event: HookEvent) => boolean
    resolve: (event: HookEvent) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }[] = []

  start(exePath: string): boolean {
    if (!existsSync(exePath)) {
      console.error('[hook] binary not found:', exePath)
      return false
    }

    // detached: keep the hook outside Electron's process group/job where possible.
    this.proc = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true
    })

    const rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line) as HookEvent
        this.emit('event', event)
        for (const waiter of [...this.waiters]) {
          if (!waiter.match(event)) continue
          clearTimeout(waiter.timer)
          this.waiters = this.waiters.filter((item) => item !== waiter)
          waiter.resolve(event)
        }
      } catch {
        // Ignore malformed lines; the sidecar also emits pings.
      }
    })

    this.proc.stderr.on('data', (data: Buffer) => {
      console.error('[hook]', data.toString().trim())
    })

    this.proc.on('exit', (code) => {
      console.log('[hook] exited', code)
      this.proc = null
      if (!this.stopping) this.emit('exit', code)
    })

    return true
  }

  stop(): void {
    this.stopping = true
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('The hook stopped.'))
    }
    this.waiters = []
    this.proc?.kill()
    this.proc = null
  }

  isRunning(): boolean {
    return this.proc !== null
  }

  send(command: string): boolean {
    if (!this.proc?.stdin.writable) return false
    this.proc.stdin.write(command.endsWith('\n') ? command : `${command}\n`)
    return true
  }

  waitFor(
    match: (event: HookEvent) => boolean,
    timeoutMs: number
  ): Promise<HookEvent> {
    return new Promise((resolve, reject) => {
      const waiter = {
        match,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter)
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for the hook.`))
        }, timeoutMs)
      }
      this.waiters.push(waiter)
    })
  }
}
