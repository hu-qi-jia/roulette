import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  addKbDocument,
  closeStore,
  deleteKbDocument,
  kbStats,
  listKbDocuments,
  openStore,
  searchKb
} from '../src/main/store.ts'

const dir = path.join(process.cwd(), 'out', 'kb-store-test')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'roulette.db')

const DIM = 512
const vec = (pairs) => {
  const output = new Float32Array(DIM)
  for (const [index, value] of pairs) output[index] = value
  return output
}

assert.equal(openStore(file), true)

const cats = addKbDocument({
  title: 'Cats',
  source: 'paste',
  chunks: ['cats are great', 'dogs are loyal'],
  vectors: [vec([[0, 1]]), vec([[1, 0]])]
})
assert.ok(cats)
assert.equal(cats.chunkCount, 2)

const roulette = addKbDocument({
  title: 'Roulette',
  source: 'file',
  chunks: ['roulette is a desktop tool'],
  vectors: [vec([[0, 0.95], [1, 0.05]])]
})
assert.ok(roulette)

const stats = kbStats()
assert.equal(stats.documents, 2)
assert.equal(stats.chunks, 3)
assert.equal(stats.mode, 'vec0')

const docs = listKbDocuments()
assert.equal(docs.length, 2)
assert.equal(docs[0].id, roulette.id)
assert.equal(docs[0].chunkCount, 1)

const hits = searchKb(vec([[0, 1]]), 2)
assert.equal(hits.length, 2)
assert.equal(hits[0].chunkId, 1)
assert.equal(hits[0].title, 'Cats')
assert.equal(hits[0].content, 'cats are great')
assert.equal(hits[1].title, 'Roulette')
assert.ok(hits[0].distance < hits[1].distance)

deleteKbDocument(cats.id)
assert.equal(kbStats().documents, 1)
assert.equal(kbStats().chunks, 1)
assert.equal(searchKb(vec([[0, 1]]), 5).length, 1)

closeStore()
assert.equal(openStore(file), true)
assert.equal(kbStats().documents, 1)
closeStore()

fs.rmSync(dir, { recursive: true, force: true })
console.log('KB STORE TEST PASSED')
