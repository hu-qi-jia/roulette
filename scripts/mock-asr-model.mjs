import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const PORT = Number(process.env.MOCK_ASR_PORT || 8788)
const dir = path.resolve(process.argv[2] || path.join(process.cwd(), 'out', 'asr-model-fixture'))

const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0].replace(/^\/+/, ''))
  const file = path.join(dir, name)
  if (!name || !fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }

  const size = fs.statSync(file).size
  let start = 0
  let end = size - 1
  let status = 200

  const range = req.headers.range
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range)
    if (match) {
      start = Number(match[1])
      if (match[2]) end = Number(match[2])
      if (start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` })
        res.end()
        return
      }
      status = 206
    }
  }

  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes'
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  res.writeHead(status, headers)
  fs.createReadStream(file, { start, end }).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-asr] serving ${dir} on http://127.0.0.1:${PORT}`)
})
