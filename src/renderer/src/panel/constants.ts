import type { ChatErrorCode, Sector, SessionKind } from '../../../shared/types'

export const WELCOME_ID = 0

export const KIND_BY_ACTION: Record<Sector, SessionKind> = {
  text: 'chat',
  screenshot: 'screenshot',
  voice: 'voice',
  history: 'chat'
}

export const ACTION_BY_KIND: Record<SessionKind, Sector> = {
  chat: 'text',
  screenshot: 'screenshot',
  voice: 'voice'
}

export const KIND_LABEL: Record<SessionKind, string> = {
  chat: 'text',
  screenshot: 'shot',
  voice: 'voiceLabel'
}

export const ERROR_KEYS: Record<ChatErrorCode, string> = {
  'no-key': 'errNoKey',
  'no-base-url': 'errNoBaseUrl',
  'no-model': 'errNoModel',
  'no-vision-model': 'errNoVisionModel',
  'image-unreadable': 'errImage',
  auth: 'errAuth',
  'rate-limit': 'errRateLimit',
  server: 'errServer',
  network: 'errNetwork',
  http: 'errHttp',
  unknown: 'errUnknown'
}

export const ACTIONABLE_ERRORS: ReadonlySet<ChatErrorCode> = new Set([
  'no-key',
  'no-base-url',
  'no-model',
  'no-vision-model',
  'auth'
])
