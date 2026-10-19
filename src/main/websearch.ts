export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  summary: string
  score: number
  date: string | null
}

function searchBaseUrl(baseUrl: string): string {
  const override = process.env.ROULETTE_SEARCH_BASE?.trim()
  if (override) return override.replace(/\/+$/, '')
  return new URL(baseUrl).origin
}

/** DeepSeek hosts its Search API next to the chat API. */
export function supportsHostWebSearch(baseUrl: string): boolean {
  if (process.env.ROULETTE_SEARCH_BASE?.trim()) return true
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'deepseek.com' || host.endsWith('.deepseek.com')
  } catch {
    return false
  }
}

interface DeepSeekSearchItem {
  title?: unknown
  url?: unknown
  snippet?: unknown
  summary?: unknown
  rerank_score?: unknown
  date?: unknown
}

export async function searchWeb(
  baseUrl: string,
  apiKey: string,
  query: string
): Promise<WebSearchResult[]> {
  let endpoint: string
  try {
    endpoint = `${searchBaseUrl(baseUrl)}/v1/tools/search`
  } catch {
    return []
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query,
        count: 6,
        need_content: false,
        ori_question: query.slice(0, 128)
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200)
      console.warn('[web] search failed', response.status, detail)
      return []
    }
    const data = (await response.json()) as { results?: DeepSeekSearchItem[] }
    return (data.results ?? [])
      .map((item): WebSearchResult | null => {
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        const url = typeof item.url === 'string' ? item.url.trim() : ''
        if (!title || !url) return null
        return {
          title,
          url,
          snippet: typeof item.snippet === 'string' ? item.snippet : '',
          summary: typeof item.summary === 'string' ? item.summary : '',
          score: Number(item.rerank_score ?? 0),
          date: typeof item.date === 'string' ? item.date : null
        }
      })
      .filter((item): item is WebSearchResult => item !== null)
      .filter((item) => item.score >= 1.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
  } catch (error) {
    console.warn('[web] search failed', error)
    return []
  } finally {
    clearTimeout(timer)
  }
}

export function buildWebContext(results: WebSearchResult[], question: string): string {
  const lines = results.map(
    (result, index) =>
      `[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.summary || result.snippet}`
  )
  return `The following web search results were retrieved just now for the user's question: "${question}". Use them for current events, weather, prices, releases, or other live facts. Cite used results as [1], [2], etc. and include their URLs. Ignore results that are unrelated. If the results do not answer the question, answer normally from your own knowledge and say what may be outdated.\n\n${lines.join('\n\n')}`
}
