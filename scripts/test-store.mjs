import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  appendMessage,
  closeStore,
  deleteSession,
  ensureSession,
  getMessages,
  getSession,
  listSessions,
  openStore
} from '../src/main/store.ts'

const dir = path.join(process.cwd(), 'out', 'store-test')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'roulette.db')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

assert.equal(openStore(file), true)

const longQuestion =
  'hello world this is a rather long first message used to verify title truncation behaviour'

ensureSession({ id: 's1', kind: 'chat', appName: null })
const userMessageId = appendMessage('s1', 'user', longQuestion)
assert.equal(typeof userMessageId, 'number')
appendMessage('s1', 'assistant', 'hi there')

await sleep(5)
ensureSession({ id: 's2', kind: 'screenshot', appName: null })
appendMessage('s2', 'user', 'describe this')

const list = listSessions()
assert.equal(list.length, 2)
assert.equal(list[0].id, 's2', 'most recently updated session comes first')
assert.equal(list[0].kind, 'screenshot')
assert.equal(list[0].messageCount, 1)
assert.equal(list[0].preview, 'describe this')
assert.equal(list[1].id, 's1')
assert.equal(list[1].title.length, 41, 'title is truncated to 40 chars plus an ellipsis')
assert.ok(list[1].title.endsWith('…'))

const detail = getSession('s1')
assert.ok(detail)
assert.equal(detail.messages.length, 2)
assert.equal(detail.messages[0].role, 'user')
assert.equal(detail.messages[0].content, longQuestion)
assert.equal(detail.preview, 'hi there')

const messages = getMessages('s1')
assert.equal(messages.length, 2)
assert.equal(messages[0].role, 'user')
assert.equal(messages[0].content, longQuestion)
assert.equal(messages[0].imagePath, null)
assert.equal(typeof messages[0].id, 'number')
assert.equal(messages[1].content, 'hi there')

// Appending to a deleted session must be ignored, not raise a foreign-key error.
assert.deepEqual(deleteSession('s1'), [])
assert.equal(getSession('s1'), null)
assert.deepEqual(getMessages('s1'), [])
assert.equal(appendMessage('s1', 'assistant', 'late'), null)

// Deleting a session reports the image files that belonged to it.
ensureSession({ id: 's3', kind: 'screenshot', appName: null })
appendMessage('s3', 'user', 'look', 'C:/tmp/shot.jpg')
assert.deepEqual(deleteSession('s3'), ['C:/tmp/shot.jpg'])

// History survives a restart.
closeStore()
assert.equal(openStore(file), true)
assert.equal(listSessions().length, 1)
assert.equal(listSessions()[0].id, 's2')
closeStore()

fs.rmSync(dir, { recursive: true, force: true })
console.log('STORE TEST PASSED')
