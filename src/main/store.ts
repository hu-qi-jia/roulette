import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getLoadablePath } from 'sqlite-vec'
import type {
  KbDocumentSummary,
  SessionDetail,
  SessionKind,
  SessionSummary,
  StoredMessage
} from '../shared/types'

const TITLE_LENGTH = 40
const PREVIEW_LENGTH = 60
const VECTOR_DIMENSION = 512

let db: DatabaseSync | null = null
let vectorMode: 'vec0' | 'blob' = 'blob'

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    kind        TEXT NOT NULL DEFAULT 'chat',
    app_name    TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    image_path  TEXT,
    meta        TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

  CREATE TABLE IF NOT EXISTS kb_documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    source      TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_chunks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,
    content     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_kb_chunks_document ON kb_chunks(document_id, ordinal);

  CREATE TABLE IF NOT EXISTS kb_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

const SESSION_COLUMNS = `
  s.id,
  s.title,
  s.kind,
  s.app_name AS appName,
  s.created_at AS createdAt,
  s.updated_at AS updatedAt,
  (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS messageCount,
  COALESCE(
    (SELECT m.content FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1),
    ''
  ) AS preview
`

export function openStore(file: string): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    db = new DatabaseSync(file, { allowExtension: true } as never)
    try {
      db.loadExtension(getLoadablePath())
      vectorMode = 'vec0'
    } catch (error) {
      console.warn('[store] sqlite-vec unavailable; using JS cosine fallback', error)
      vectorMode = 'blob'
    }
    db.exec(SCHEMA)
    ensureMessageMeta()
    ensureVectorSchema()
    return true
  } catch (error) {
    console.error('[store] failed to open', file, error)
    db = null
    return false
  }
}

function ensureMessageMeta(): void {
  if (!db) return
  const columns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'meta')) {
    db.exec('ALTER TABLE messages ADD COLUMN meta TEXT')
  }
}

function ensureVectorSchema(): void {
  if (!db) return
  if (vectorMode === 'vec0') {
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS kb_vectors USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding float[${VECTOR_DIMENSION}]
      )`)
      return
    } catch (error) {
      console.warn('[store] vec0 init failed; falling back to cosine scan', error)
      vectorMode = 'blob'
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS kb_embeddings (
    chunk_id INTEGER PRIMARY KEY,
    vector BLOB NOT NULL
  )`)
}

export function closeStore(): void {
  try {
    db?.close()
  } catch (error) {
    console.warn('[store] close failed', error)
  }
  db = null
}

interface EnsureSessionInput {
  id: string
  kind: SessionKind
  appName?: string | null
}

export function ensureSession({ id, kind, appName }: EnsureSessionInput): void {
  if (!db) return
  const now = Date.now()
  db.prepare(
    `INSERT INTO sessions (id, title, kind, app_name, created_at, updated_at)
     VALUES (?, '', ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(id, kind, appName ?? null, now, now)
}

export function appendMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  imagePath: string | null = null,
  meta: string | null = null
): number | null {
  if (!db) return null
  const exists = db.prepare('SELECT 1 AS ok FROM sessions WHERE id = ?').get(sessionId)
  if (!exists) return null

  const now = Date.now()
  const result = db
    .prepare(
      `INSERT INTO messages (session_id, role, content, image_path, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(sessionId, role, content, imagePath, meta, now)

  if (role === 'user') {
    db.prepare(
      `UPDATE sessions
       SET title = CASE WHEN title = '' THEN ? ELSE title END,
           updated_at = ?
       WHERE id = ?`
    ).run(deriveTitle(content), now, sessionId)
  } else {
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
  }

  return Number(result.lastInsertRowid)
}

export function getMessages(sessionId: string): StoredMessage[] {
  if (!db) return []
  return db
    .prepare(
      `SELECT id, role, content, image_path AS imagePath, meta, created_at AS createdAt
       FROM messages WHERE session_id = ? ORDER BY id`
    )
    .all(sessionId) as unknown as StoredMessage[]
}

/** Removes the newest message only when it is the assistant reply to this
 *  exact user turn. A retry regenerates that turn; an error before the user
 *  message reached the store must not delete an older answer. */
export function deleteTrailingAssistant(sessionId: string, userText: string): void {
  if (!db) return
  const rows = db
    .prepare(
      `SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 2`
    )
    .all(sessionId) as Array<{ id: number; role: string; content: string }>
  const [last, previous] = rows
  if (!last || last.role !== 'assistant') return
  if (!previous || previous.role !== 'user' || previous.content !== userText) return
  db.prepare('DELETE FROM messages WHERE id = ?').run(last.id)
}

/** Whether a session already carries an image, without loading its history. */
export function sessionHasImages(sessionId: string): boolean {
  if (!db) return false
  return (
    db
      .prepare(
        'SELECT 1 AS ok FROM messages WHERE session_id = ? AND image_path IS NOT NULL LIMIT 1'
      )
      .get(sessionId) !== undefined
  )
}

export function listSessions(limit = 50): SessionSummary[] {
  if (!db) return []
  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS}
       FROM sessions s
       ORDER BY s.updated_at DESC
       LIMIT ?`
    )
    .all(limit) as unknown as SessionSummary[]
  return rows.map(normalizeSummary)
}

export function getSession(id: string): SessionDetail | null {
  if (!db) return null
  const row = db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions s WHERE s.id = ?`)
    .get(id) as unknown as SessionSummary | undefined
  if (!row) return null

  const messages = getMessages(id)

  return { ...normalizeSummary(row), messages }
}

/** Deletes a session and returns the image files that belonged to it. */
export function deleteSession(id: string): string[] {
  if (!db) return []
  const rows = db
    .prepare(
      `SELECT image_path AS imagePath FROM messages
       WHERE session_id = ? AND image_path IS NOT NULL`
    )
    .all(id) as Array<{ imagePath: string }>
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  return rows.map((row) => row.imagePath)
}

export function renameSession(id: string, title: string): void {
  if (!db) return
  const next = title.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!next) return
  db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(next, id)
}

export interface KbDocumentInput {
  title: string
  source: string
  chunks: string[]
  vectors: Float32Array[]
}

export interface KbSearchHit {
  chunkId: number
  documentId: number
  title: string
  content: string
  distance: number
}

export function addKbDocument(input: KbDocumentInput): KbDocumentSummary | null {
  if (!db) return null
  if (input.chunks.length === 0 || input.chunks.length !== input.vectors.length) return null
  const now = Date.now()

  db.exec('BEGIN')
  try {
    const docResult = db
      .prepare('INSERT INTO kb_documents (title, source, created_at) VALUES (?, ?, ?)')
      .run(input.title, input.source, now)
    const documentId = Number(docResult.lastInsertRowid)
    const chunkStatement = db.prepare(
      'INSERT INTO kb_chunks (document_id, ordinal, content) VALUES (?, ?, ?)'
    )
    const vectorStatement =
      vectorMode === 'vec0'
        ? db.prepare('INSERT INTO kb_vectors (chunk_id, embedding) VALUES (?, ?)')
        : db.prepare('INSERT INTO kb_embeddings (chunk_id, vector) VALUES (?, ?)')

    for (let index = 0; index < input.chunks.length; index += 1) {
      const chunkResult = chunkStatement.run(documentId, index, input.chunks[index])
      const chunkId = Number(chunkResult.lastInsertRowid)
      const vector = input.vectors[index]
      const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
      if (vectorMode === 'vec0') {
        vectorStatement.run(BigInt(chunkId), bytes)
      } else {
        vectorStatement.run(chunkId, bytes)
      }
    }

    db.exec('COMMIT')
    return {
      id: documentId,
      title: input.title,
      source: input.source,
      chunkCount: input.chunks.length,
      createdAt: now
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function listKbDocuments(): KbDocumentSummary[] {
  if (!db) return []
  return db
    .prepare(
      `SELECT d.id, d.title, d.source, d.created_at AS createdAt,
         (SELECT COUNT(*) FROM kb_chunks c WHERE c.document_id = d.id) AS chunkCount
       FROM kb_documents d
       ORDER BY d.id DESC`
    )
    .all() as unknown as KbDocumentSummary[]
}

export function deleteKbDocument(id: number): void {
  if (!db) return
  const chunkIds = db
    .prepare('SELECT id FROM kb_chunks WHERE document_id = ?')
    .all(id) as Array<{ id: number }>
  const deleteVector =
    vectorMode === 'vec0'
      ? db.prepare('DELETE FROM kb_vectors WHERE chunk_id = ?')
      : db.prepare('DELETE FROM kb_embeddings WHERE chunk_id = ?')
  for (const row of chunkIds) {
    deleteVector.run(vectorMode === 'vec0' ? BigInt(row.id) : row.id)
  }
  db.prepare('DELETE FROM kb_documents WHERE id = ?').run(id)
}

export function kbStats(): { documents: number; chunks: number; mode: string } {
  if (!db) return { documents: 0, chunks: 0, mode: vectorMode }
  const documents = Number(
    (db.prepare('SELECT COUNT(*) AS n FROM kb_documents').get() as { n: number }).n
  )
  const chunks = Number(
    (db.prepare('SELECT COUNT(*) AS n FROM kb_chunks').get() as { n: number }).n
  )
  return { documents, chunks, mode: vectorMode }
}

/** Retrieval only needs to know whether the index is empty; a COUNT scan is
 *  not worth repeating on every chat turn. */
export function hasKbChunks(): boolean {
  if (!db) return false
  return db.prepare('SELECT 1 AS ok FROM kb_chunks LIMIT 1').get() !== undefined
}

export function searchKb(vector: Float32Array, limit = 5): KbSearchHit[] {
  if (!db || limit <= 0) return []

  if (vectorMode === 'vec0') {
    const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
    const rows = db
      .prepare(
        `SELECT chunk_id AS chunkId, distance FROM kb_vectors
         WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
      )
      .all(bytes, limit) as Array<{ chunkId: number | bigint; distance: number }>
    if (rows.length === 0) return []

    const ids = rows.map((row) => Number(row.chunkId))
    const placeholders = ids.map(() => '?').join(',')
    const chunks = db
      .prepare(
        `SELECT c.id AS chunkId, c.document_id AS documentId, c.content, d.title
         FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
         WHERE c.id IN (${placeholders})`
      )
      .all(...ids) as unknown as Array<Omit<KbSearchHit, 'distance'>>
    const byId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]))

    return rows
      .map((row) => {
        const chunk = byId.get(Number(row.chunkId))
        if (!chunk) return null
        return { ...chunk, distance: Number(row.distance) }
      })
      .filter((hit): hit is KbSearchHit => hit !== null)
  }

  const rows = db
    .prepare(
      `SELECT e.chunk_id AS chunkId, e.vector AS vector,
              c.document_id AS documentId, c.content, d.title
       FROM kb_embeddings e
       JOIN kb_chunks c ON c.id = e.chunk_id
       JOIN kb_documents d ON d.id = c.document_id`
    )
    .all() as Array<{
    chunkId: number
    vector: Uint8Array
    documentId: number
    content: string
    title: string
  }>

  const scored = rows.map((row) => {
    const stored = new Float32Array(
      row.vector.buffer,
      row.vector.byteOffset,
      row.vector.byteLength / 4
    )
    let dot = 0
    for (let index = 0; index < vector.length; index += 1) {
      dot += vector[index] * stored[index]
    }
    return {
      chunkId: Number(row.chunkId),
      documentId: Number(row.documentId),
      title: row.title,
      content: row.content,
      distance: Math.sqrt(Math.max(0, 2 - 2 * dot))
    }
  })
  scored.sort((a, b) => a.distance - b.distance)
  return scored.slice(0, limit)
}

export function getKbMeta(key: string): string | null {
  if (!db) return null
  const row = db.prepare('SELECT value FROM kb_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setKbMeta(key: string, value: string): void {
  if (!db) return
  db.prepare(
    'INSERT INTO kb_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

function normalizeSummary(row: SessionSummary): SessionSummary {
  const preview = String(row.preview ?? '').replace(/\s+/g, ' ').trim()
  return {
    ...row,
    title: row.title || '',
    appName: row.appName ?? null,
    messageCount: Number(row.messageCount ?? 0),
    preview:
      preview.length > PREVIEW_LENGTH ? `${preview.slice(0, PREVIEW_LENGTH)}…` : preview
  }
}

function deriveTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > TITLE_LENGTH ? `${flat.slice(0, TITLE_LENGTH)}…` : flat
}
