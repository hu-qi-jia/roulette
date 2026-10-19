import type { ChatMessage } from '../shared/types'

export interface EngineConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Extra system instructions, e.g. retrieved knowledge-base context. */
  systemContext?: string
  /** Ask the provider/model to use its web-search capability when available. */
  webSearch?: boolean
}

const SYSTEM_PROMPT =
  "You are a concise assistant. Answer the user's question directly, in the same language as the user's latest message. Do not repeat reference material verbatim. Return plain text only."

const WEB_SEARCH_PROMPT =
  'Web search is available. When the answer depends on current events, live data, prices, releases, or facts you are not confident about, search the web before answering and cite the source URLs. If web search is unavailable, answer normally and note any uncertainty.'

type OpenAiContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >

function toOpenAiMessage(message: ChatMessage): {
  role: string
  content: OpenAiContent
} {
  if (!message.images?.length) {
    return { role: message.role, content: message.content }
  }

  const parts: Exclude<OpenAiContent, string> = []
  if (message.content.trim()) {
    parts.push({ type: 'text', text: message.content })
  }
  for (const image of message.images) {
    parts.push({ type: 'image_url', image_url: { url: image } })
  }
  return { role: message.role, content: parts }
}

export async function* streamChat(
  config: EngineConfig,
  messages: ChatMessage[],
  signal: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

  const systemContent = [
    SYSTEM_PROMPT,
    config.webSearch ? WEB_SEARCH_PROMPT : '',
    config.systemContext ?? ''
  ]
    .filter(Boolean)
    .join('\n\n')

  const body: Record<string, unknown> = {
    model: config.model,
    stream: true,
    messages: [
      { role: 'system', content: systemContent },
      ...messages.map(toOpenAiMessage)
    ]
  }
  // OpenAI's chat-completions search field. Providers that do not know it are
  // retried below without it; the system prompt still lets capable models
  // search on their own.
  if (config.webSearch) body.web_search_options = {}

  const send = (payload: Record<string, unknown>): Promise<Response> =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(payload),
      signal
    })

  let response = await send(body)
  if (config.webSearch && (response.status === 400 || response.status === 422)) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    console.warn(
      '[engine] web_search_options was rejected; retrying without it',
      detail
    )
    delete body.web_search_options
    response = await send(body)
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 400)
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }

  if (!response.body) {
    throw new Error('The provider returned an empty response body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const raw = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')

        if (!raw.startsWith('data:')) continue
        const data = raw.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') return

        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string | null } }[]
          }
          const delta = parsed.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) yield delta
        } catch {
          // Keep-alives and provider-specific chunks are ignored.
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
