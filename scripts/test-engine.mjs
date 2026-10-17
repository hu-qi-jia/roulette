import { streamChat } from '../src/main/engine.ts'

const controller = new AbortController()
let output = ''

try {
  for await (const delta of streamChat(
    { baseUrl: 'http://127.0.0.1:8787/v1', apiKey: 'test', model: 'mock' },
    [{ role: 'user', content: 'hello from engine test' }],
    controller.signal
  )) {
    output += delta
  }
  console.log('RESULT:', JSON.stringify(output))
} catch (error) {
  console.error('ENGINE ERROR:', error)
  process.exitCode = 1
}
