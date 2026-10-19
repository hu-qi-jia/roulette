export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

type Translate = (key: string) => string

/** Compact session timestamp, in the voice of the history cards. */
export function formatSessionTime(
  timestamp: number,
  language: string,
  t: Translate
): string {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const locale = language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'

  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)

  if (timestamp >= startOfToday) return `${t('today')} ${time}`
  if (timestamp >= startOfYesterday) return `${t('yesterday')} ${time}`

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric'
  }).format(timestamp)
}
