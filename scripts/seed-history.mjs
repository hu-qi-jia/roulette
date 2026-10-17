import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  appendMessage,
  closeStore,
  ensureSession,
  openStore
} from '../src/main/store.ts'

const dir = path.join(process.env.APPDATA, 'roulette')
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'roulette.db')

for (const suffix of ['', '-shm', '-wal']) {
  fs.rmSync(`${file}${suffix}`, { force: true })
}

assert(openStore(file), 'failed to open the store')

const now = Date.now()
const sessions = [
  {
    id: 'seed-today-1',
    kind: 'chat',
    question: '如何把这段代码改成 TypeScript？',
    answer: '先把数据结构定义成 interface，再逐个函数补上参数类型。',
    at: now - 2 * 60 * 1000
  },
  {
    id: 'seed-today-2',
    kind: 'screenshot',
    question: '这张架构图有什么问题？',
    answer: '鉴权层和业务层之间缺少明确的边界，建议把 token 校验前移。',
    at: now - 40 * 60 * 1000
  },
  {
    id: 'seed-yesterday',
    kind: 'voice',
    question: '明天下午三点提醒我开会',
    answer: '好的，明天下午三点提醒你。',
    at: now - 26 * 60 * 60 * 1000
  },
  {
    id: 'seed-earlier',
    kind: 'chat',
    question: '解释一下 CAP 定理',
    answer: '一致性、可用性和分区容错性三者不可同时满足。',
    at: now - 5 * 24 * 60 * 60 * 1000
  }
]

for (const session of sessions) {
  ensureSession({ id: session.id, kind: session.kind })
  appendMessage(session.id, 'user', session.question)
  appendMessage(session.id, 'assistant', session.answer)
}

closeStore()

const db = new DatabaseSync(file)
for (const session of sessions) {
  db.prepare('UPDATE sessions SET created_at = ?, updated_at = ? WHERE id = ?').run(
    session.at,
    session.at,
    session.id
  )
}
db.close()

console.log(`seeded ${sessions.length} sessions into ${file}`)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
