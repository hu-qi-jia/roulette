import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { app } from 'electron'
import type { AsrResult, AsrStatus } from '../shared/types'

const MODEL_REPO = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
const BASE_URLS = [
  `https://huggingface.co/csukuangfj/${MODEL_REPO}/resolve/main`,
  `https://hf-mirror.com/csukuangfj/${MODEL_REPO}/resolve/main`
]

// Sizes from the published int8 model, used for progress and resume checks.
const MODEL_FILES = [
  { name: 'model.int8.onnx', expectedBytes: 239233841 },
  { name: 'tokens.txt', expectedBytes: 315894 }
]

const SAMPLE_RATE = 16000

let downloadState = {
  downloading: false,
  received: 0,
  total: 0,
  error: null as string | null
}
let activeDownload: Promise<void> | null = null

type Sherpa = typeof import('sherpa-onnx-node')
let sherpa: Sherpa | null = null
let recognizer: import('sherpa-onnx-node').OfflineRecognizer | null = null
let loading: Promise<import('sherpa-onnx-node').OfflineRecognizer> | null = null
let queue: Promise<unknown> = Promise.resolve()

export function modelDir(): string {
  const override = process.env.ROULETTE_ASR_MODEL_DIR?.trim()
  return override ? path.resolve(override) : path.join(app.getPath('userData'), 'models', 'sensevoice')
}

export function getAsrStatus(): AsrStatus {
  const dir = modelDir()
  return {
    installed: MODEL_FILES.every((file) => isFileReady(path.join(dir, file.name))),
    downloading: downloadState.downloading,
    receivedBytes: downloadState.received,
    totalBytes: downloadState.total,
    modelDir: dir,
    error: downloadState.error ?? undefined
  }
}

export function downloadModel(onProgress: (status: AsrStatus) => void): Promise<void> {
  if (activeDownload) return activeDownload
  activeDownload = runDownload(onProgress).finally(() => {
    activeDownload = null
  })
  return activeDownload
}

async function runDownload(onProgress: (status: AsrStatus) => void): Promise<void> {
  const dir = modelDir()
  fs.mkdirSync(dir, { recursive: true })

  downloadState = { downloading: true, received: 0, total: 0, error: null }
  const pending = MODEL_FILES.filter((file) => !isFileReady(path.join(dir, file.name)))
  downloadState.total = pending.reduce((total, file) => total + file.expectedBytes, 0)
  onProgress(getAsrStatus())

  const override = process.env.ROULETTE_ASR_MODEL_BASE?.trim()
  const bases = override
    ? [override.replace(/\/+$/, '')]
    : BASE_URLS
  let completed = 0

  try {
    for (const file of pending) {
      const dest = path.join(dir, file.name)
      await downloadFile(bases, file.name, dest, (received) => {
        downloadState.received = completed + received
        onProgress(getAsrStatus())
      })
      completed += file.expectedBytes
    }
    downloadState.received = downloadState.total
  } catch (error) {
    downloadState.error = error instanceof Error ? error.message : String(error)
    console.error('[asr] download failed', error)
    throw error
  } finally {
    downloadState.downloading = false
    onProgress(getAsrStatus())
  }
}

async function downloadFile(
  bases: string[],
  name: string,
  dest: string,
  onBytes: (received: number) => void
): Promise<void> {
  const part = `${dest}.part`
  let lastError: unknown = null

  for (const base of bases) {
    try {
      const offset = fs.existsSync(part) ? fs.statSync(part).size : 0
      onBytes(offset)
      await streamTo(`${base}/${name}`, part, offset, onBytes)
      if (!isFileReady(part)) throw new Error('The download produced an empty file.')
      fs.renameSync(part, dest)
      console.log('[asr] downloaded', name, 'via', new URL(base).host)
      return
    } catch (error) {
      lastError = error
      console.warn('[asr] mirror failed', base, error)
      // Keep the .part file so the next mirror can resume from it.
      try {
        onBytes(fs.statSync(part).size)
      } catch {
        onBytes(0)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Speech model download failed.')
}

async function streamTo(
  url: string,
  part: string,
  offset: number,
  onBytes: (received: number) => void
): Promise<void> {
  const controller = new AbortController()
  // Fail over to the next mirror if no response arrives.
  const timer = setTimeout(() => controller.abort(), 15000)
  let response: Response
  try {
    response = await fetch(url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 416) {
    // Everything was already downloaded in the .part file.
    return
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const resumed = response.status === 206 && offset > 0
  const start = resumed ? offset : 0
  const reader = response.body?.getReader()
  if (!reader) throw new Error('The provider returned an empty response body.')

  const file = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' })
  let received = start
  let idleTimer: NodeJS.Timeout | null = null
  const resetIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    // A stalled body should fail over to the next mirror, not hang forever.
    idleTimer = setTimeout(() => controller.abort(), 30000)
  }
  resetIdleTimer()

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      resetIdleTimer()
      if (!value) continue
      received += value.length
      if (!file.write(Buffer.from(value))) {
        await once(file, 'drain')
      }
      onBytes(received)
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    reader.releaseLock()
    await new Promise<void>((resolve, reject) => {
      file.end((error?: Error | null) => (error ? reject(error) : resolve()))
    })
  }

  const expectedHeader = response.headers.get('content-length')
  if (expectedHeader) {
    const expected = Number(expectedHeader) + start
    if (Number.isFinite(expected) && received !== expected) {
      throw new Error(`Incomplete download (${received} of ${expected} bytes).`)
    }
  }
}

function isFileReady(file: string): boolean {
  try {
    return fs.statSync(file).size > 0
  } catch {
    return false
  }
}

export function transcribe(samples: Float32Array, sampleRate: number): Promise<AsrResult> {
  const run = queue.then(() => runTranscription(samples, sampleRate))
  queue = run.catch(() => {})
  return run
}

async function runTranscription(samples: Float32Array, sampleRate: number): Promise<AsrResult> {
  if (!samples || samples.length < SAMPLE_RATE / 10) {
    return { text: '', lang: '', emotion: '' }
  }

  const pcm = sampleRate === SAMPLE_RATE ? samples : resample(samples, sampleRate)
  const engine = await loadRecognizer()
  const stream = engine.createStream()
  stream.acceptWaveform({ samples: pcm, sampleRate: SAMPLE_RATE })
  await engine.decodeAsync(stream)
  const result = engine.getResult(stream)
  const strip = (value: string): string => value.replace(/<\|[^|]*\|>/g, '').trim()

  return {
    text: strip(result.text ?? ''),
    lang: strip(result.lang ?? ''),
    emotion: strip(result.emotion ?? '')
  }
}

async function loadRecognizer(): Promise<import('sherpa-onnx-node').OfflineRecognizer> {
  if (recognizer) return recognizer
  if (loading) return loading

  loading = (async () => {
    const dir = modelDir()
    const model = path.join(dir, 'model.int8.onnx')
    const tokens = path.join(dir, 'tokens.txt')
    if (!isFileReady(model) || !isFileReady(tokens)) {
      throw new Error('The speech model is not installed.')
    }

    if (!sherpa) {
      const imported = await import('sherpa-onnx-node')
      sherpa = ((imported as { default?: Sherpa }).default ?? imported) as Sherpa
    }

    const config = {
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model,
          language: 'auto',
          useInverseTextNormalization: 1
        },
        tokens,
        numThreads: Math.max(1, Math.min(4, os.cpus().length - 1)),
        debug: 0,
        provider: 'cpu'
      }
    }

    const started = Date.now()
    const created = await sherpa.OfflineRecognizer.createAsync(config)
    console.log('[asr] model loaded in', Date.now() - started, 'ms')
    recognizer = created
    return created
  })().finally(() => {
    loading = null
  })

  return loading
}

function resample(input: Float32Array, from: number): Float32Array {
  const ratio = from / SAMPLE_RATE
  const length = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const index = Math.floor(position)
    const next = Math.min(index + 1, input.length - 1)
    const fraction = position - index
    output[i] = input[index] * (1 - fraction) + input[next] * fraction
  }
  return output
}
