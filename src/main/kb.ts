import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { KbDocumentSummary, KbStatus, KbSource } from '../shared/types'
import {
  addKbDocument,
  hasKbChunks,
  searchKb,
  setKbMeta
} from './store'

export const EMBEDDING_MODEL_ID = 'Xenova/bge-small-zh-v1.5'
export const EMBEDDING_DIMENSION = 512

const QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：'
const CHUNK_SIZE = 700
const CHUNK_OVERLAP = 120
const BATCH_SIZE = 8
const MAX_DISTANCE = 0.95
const MIRRORS = ['https://hf-mirror.com', 'https://huggingface.co']

type Extractor = (
  texts: string[],
  options: Record<string, unknown>
) => Promise<{ data: Float32Array | number[]; dims: number[] }>

let extractor: Extractor | null = null
let loading: Promise<Extractor> | null = null
let progressSink: ((status: KbStatus) => void) | null = null
let ingestSink: ((progress: { stage: 'embedding'; current: number; total: number }) => void) | null =
  null

const progress = {
  downloading: false,
  receivedBytes: 0,
  totalBytes: 0,
  ratio: 0,
  error: null as string | null
}

export function embeddingModelDir(): string {
  return path.join(app.getPath('userData'), 'models', 'embeddings')
}

function readyMarker(): string {
  return path.join(embeddingModelDir(), '.ready')
}

export function isEmbeddingModelInstalled(): boolean {
  return fs.existsSync(readyMarker())
}

export function getKbStatus(): KbStatus {
  return {
    installed: isEmbeddingModelInstalled(),
    // `extractor` is non-null after the model has loaded. Only a pending
    // load means "loading"; otherwise the settings page would show the
    // loading state forever once the model is ready.
    loading: loading !== null,
    downloading: progress.downloading,
    progress: progress.ratio,
    receivedBytes: progress.receivedBytes,
    totalBytes: progress.totalBytes,
    modelId: EMBEDDING_MODEL_ID,
    modelDir: embeddingModelDir(),
    error: progress.error ?? undefined
  }
}

export function setKbProgressSink(sink: ((status: KbStatus) => void) | null): void {
  progressSink = sink
}

export function setKbIngestSink(
  sink: ((progress: { stage: 'embedding'; current: number; total: number }) => void) | null
): void {
  ingestSink = sink
}

function emitStatus(): void {
  progressSink?.(getKbStatus())
}

async function loadExtractor(): Promise<Extractor> {
  if (extractor) return extractor
  if (loading) return loading

  progress.error = null
  progress.downloading = true
  progress.receivedBytes = 0
  progress.totalBytes = 0
  progress.ratio = 0
  emitStatus()

  let lastProgressEmit = 0
  loading = (async () => {
    const mod = (await import('@huggingface/transformers')) as unknown as {
      env: Record<string, unknown>
      pipeline: (
        task: string,
        model: string,
        options: Record<string, unknown>
      ) => Promise<Extractor>
    }
    const env = mod.env
    env.cacheDir = embeddingModelDir()
    env.allowLocalModels = false
    env.useBrowserCache = false

    const options = {
      dtype: 'q8',
      progress_callback: (event: {
        status?: string
        loaded?: number
        total?: number
      }) => {
        if (event.status === 'progress') {
          progress.downloading = true
          progress.receivedBytes = Number(event.loaded ?? 0)
          progress.totalBytes = Number(event.total ?? 0)
          progress.ratio = progress.totalBytes
            ? Math.min(1, progress.receivedBytes / progress.totalBytes)
            : 0
          // The downloader reports every chunk; throttle the IPC status push.
          const now = Date.now()
          if (now - lastProgressEmit >= 100) {
            lastProgressEmit = now
            emitStatus()
          }
        } else if (event.status === 'done') {
          progress.downloading = false
          emitStatus()
        }
      }
    }

    let lastError: unknown = null
    for (const host of MIRRORS) {
      try {
        env.remoteHost = host
        const pipe = await mod.pipeline('feature-extraction', EMBEDDING_MODEL_ID, options)
        extractor = pipe
        fs.mkdirSync(embeddingModelDir(), { recursive: true })
        fs.writeFileSync(readyMarker(), EMBEDDING_MODEL_ID, 'utf8')
        setKbMeta('embedding_model', EMBEDDING_MODEL_ID)
        setKbMeta('embedding_dimension', String(EMBEDDING_DIMENSION))
        progress.downloading = false
        progress.ratio = 1
        emitStatus()
        console.log('[kb] embedding model ready:', EMBEDDING_MODEL_ID)
        return pipe
      } catch (error) {
        lastError = error
        console.warn('[kb] model load failed from', host, error)
      }
    }

    progress.downloading = false
    progress.error = lastError instanceof Error ? lastError.message : String(lastError)
    emitStatus()
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  })().finally(() => {
    loading = null
    emitStatus()
  })

  return loading
}

export async function prepareKb(): Promise<KbStatus> {
  try {
    await loadExtractor()
  } catch {
    // The status carries the error.
  }
  return getKbStatus()
}

async function embedTexts(
  texts: string[],
  onProgress?: (current: number, total: number) => void
): Promise<Float32Array[]> {
  const pipe = await loadExtractor()
  const results: Float32Array[] = []

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE)
    const output = await pipe(batch, { pooling: 'cls', normalize: true })
    const dims = output.dims
    const dimension = dims[dims.length - 1]
    const data =
      output.data instanceof Float32Array ? output.data : new Float32Array(output.data)
    for (let index = 0; index < batch.length; index += 1) {
      results.push(data.slice(index * dimension, (index + 1) * dimension))
    }
    onProgress?.(Math.min(texts.length, start + batch.length), texts.length)
  }

  return results
}

export async function embedQuery(query: string): Promise<Float32Array> {
  const [vector] = await embedTexts([QUERY_PREFIX + query])
  return vector
}

export function chunkText(text: string): string[] {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''

  const flush = (): void => {
    const value = current.trim()
    if (value) chunks.push(value)
    current = ''
  }

  const append = (part: string): void => {
    if (!part) return
    if (!current) {
      current = part
    } else if (current.length + 1 + part.length <= CHUNK_SIZE) {
      current += `\n${part}`
    } else {
      flush()
      if (part.length <= CHUNK_SIZE) {
        current = part
        return
      }
      const sentences = part.split(/(?<=[。！？!?；;.])\s*/).filter(Boolean)
      for (const sentence of sentences) {
        if (current.length + sentence.length > CHUNK_SIZE) {
          const tail = current.slice(-CHUNK_OVERLAP)
          flush()
          current = (tail + sentence).slice(0, CHUNK_SIZE)
        } else {
          current += sentence
        }
      }
    }
  }

  for (const paragraph of paragraphs) append(paragraph)
  flush()

  if (chunks.length === 0 && normalized) {
    chunks.push(normalized.slice(0, CHUNK_SIZE))
  }
  return chunks
}

export async function ingestText(
  title: string,
  text: string,
  source: string
): Promise<KbDocumentSummary | null> {
  const chunks = chunkText(text)
  if (chunks.length === 0) return null

  const cleanTitle = title.trim() || text.trim().slice(0, 40) || 'Untitled'
  const vectors = await embedTexts(
    chunks.map((chunk) => `${cleanTitle}\n${chunk}`),
    (current, total) => ingestSink?.({ stage: 'embedding', current, total })
  )
  return addKbDocument({ title: cleanTitle, source, chunks, vectors })
}

export async function ingestFiles(files: string[]): Promise<KbDocumentSummary[]> {
  const added: KbDocumentSummary[] = []

  for (const file of files) {
    try {
      const stat = fs.statSync(file)
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue
      const text = fs.readFileSync(file, 'utf8')
      if (!text.trim()) continue
      const title = path.basename(file).replace(/\.[^.]+$/, '')
      const document = await ingestText(title, text, 'file')
      if (document) added.push(document)
    } catch (error) {
      console.warn('[kb] failed to ingest', file, error)
    }
  }

  return added
}

export async function retrieveKb(query: string, limit = 5): Promise<KbSource[]> {
  try {
    if (!query.trim() || !isEmbeddingModelInstalled()) return []
    if (!hasKbChunks()) return []

    const vector = await embedQuery(query)
    const hits = searchKb(vector, limit)
    if (process.env.ROULETTE_PERF === '1') {
      console.log(
        '[kb] hits',
        hits.map((hit) => `${hit.distance.toFixed(3)} ${hit.title}`).join(' | ')
      )
    }
    return hits
      .filter((hit) => hit.distance < MAX_DISTANCE)
      .map((hit) => ({
        documentId: hit.documentId,
        chunkId: hit.chunkId,
        title: hit.title,
        snippet: hit.content.slice(0, 400),
        distance: hit.distance
      }))
  } catch (error) {
    console.warn('[kb] retrieval failed', error)
    return []
  }
}
