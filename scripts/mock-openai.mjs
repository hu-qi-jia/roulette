import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT || 8787)

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }

  if (req.headers.authorization === 'Bearer bad') {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
    return
  }

  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    let parsed = {}
    try {
      parsed = JSON.parse(body)
    } catch {
      // Keep the default.
    }

    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    const parts = Array.isArray(lastUser?.content) ? lastUser.content : []
    const textPart = parts.find((part) => part.type === 'text')
    const prompt =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : typeof textPart?.text === 'string'
          ? textPart.text
          : ''
    const images = messages.reduce(
      (total, message) =>
        total +
        (Array.isArray(message.content)
          ? message.content.filter((part) => part.type === 'image_url').length
          : 0),
      0
    )
    const reply = `Mock reply to: ${prompt || '(empty)'}`
    const systemMessages = messages.filter((message) => message.role === 'system')
    const hasKbContext = systemMessages.some(
      (message) =>
        typeof message.content === 'string' &&
        (message.content.includes('knowledge base') || message.content.includes('知识库'))
    )

    console.log(
      `[mock] model=${parsed.model ?? '?'} turns=${messages.length} sys=${systemMessages.length} kb=${hasKbContext ? 1 : 0} images=${images} prompt=${JSON.stringify(prompt)}`
    )

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.flushHeaders()

    const chunks = reply.match(/.{1,4}/g) ?? []
    let index = 0
    const timer = setInterval(() => {
      if (index >= chunks.length) {
        clearInterval(timer)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      const payload = { choices: [{ delta: { content: chunks[index++] } }] }
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }, 55)

    // Stop streaming only if the response/connection actually goes away.
    res.on('close', () => clearInterval(timer))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] OpenAI-compatible endpoint: http://127.0.0.1:${PORT}/v1`)
})
