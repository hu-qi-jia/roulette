import type { ChatErrorCode, KbSource } from '../../../shared/types'

export type PanelView = 'chat' | 'history' | 'settings' | 'kb'

export interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  image?: string
  sources?: KbSource[]
  errorCode?: ChatErrorCode
  streaming?: boolean
}
