import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  SessionDetail,
  SessionKind,
  SessionSummary,
  StoredMessage
} from '../shared/types'

const TITLE_LENGTH = 40
const PREVIEW_LENGTH = 60

let db: DatabaseSync | null = null

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
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
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
    db = new DatabaseSync(file)
    db.exec(SCHEMA)
    return true
  } catch (error) {
    console.error('[store] failed to open', file, error)
    db = null
    return false
  }
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
  imagePath: string | null = null
): number | null {
  if (!db) return null
  const exists = db.prepare('SELECT 1 AS ok FROM sessions WHERE id = ?').get(sessionId)
  if (!exists) return null

  const now = Date.now()
  const result = db
    .prepare(
      `INSERT INTO messages (session_id, role, content, image_path, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(sessionId, role, content, imagePath, now)

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
      `SELECT id, role, content, image_path AS imagePath, created_at AS createdAt
       FROM messages WHERE session_id = ? ORDER BY id`
    )
    .all(sessionId) as unknown as StoredMessage[]
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
