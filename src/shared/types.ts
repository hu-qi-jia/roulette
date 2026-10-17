export type Sector = 'text' | 'screenshot' | 'voice' | 'history'
export type WheelMode = 'hold' | 'click'
export type WheelResult = Sector | 'cancel'
export type SessionKind = 'chat' | 'screenshot' | 'voice'

export interface WheelShowPayload {
  mode: WheelMode
  size: number
  deadZone: number
}

export interface WheelMovePayload {
  angle: number
  distance: number
}

export interface PanelOpenPayload {
  action: Sector
  kind: SessionKind
  image?: string
  openHistory?: boolean
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ShotDisplay {
  id: number
  bounds: Rect
  scaleFactor: number
  image: Uint8Array<ArrayBuffer>
  imageMime: string
  imageSize: { width: number; height: number }
}

export interface ShotShowPayload {
  virtual: Rect
  displays: ShotDisplay[]
}

export interface ShotCompletePayload {
  image: string
  width: number
  height: number
}

export interface SessionSummary {
  id: string
  title: string
  kind: SessionKind
  appName: string | null
  createdAt: number
  updatedAt: number
  messageCount: number
  preview: string
}

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  imagePath: string | null
  /** Data URL, filled in when history is loaded for display. */
  image?: string
  createdAt: number
}

export interface SessionDetail extends SessionSummary {
  messages: StoredMessage[]
}

export interface AppSettings {
  baseUrl: string
  textModel: string
  visionModel: string
  hasApiKey: boolean
  asrAutoSend: boolean
}

export interface SettingsInput {
  baseUrl: string
  textModel: string
  visionModel: string
  apiKey?: string
  asrAutoSend?: boolean
}

export interface AsrStatus {
  installed: boolean
  downloading: boolean
  receivedBytes: number
  totalBytes: number
  modelDir: string
  error?: string
}

export interface AsrResult {
  text: string
  lang: string
  emotion: string
}

export interface TranscribeRequest {
  samples: Float32Array
  sampleRate: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Data URLs of images attached to this message. */
  images?: string[]
}

export interface ChatRequest {
  sessionId: string
  kind: SessionKind
  appName?: string | null
  text: string
  /** Data URL of an image captured or attached in this turn. */
  image?: string
}

export type ChatErrorCode = NonNullable<ChatError['code']>

export interface ChatDelta {
  sessionId: string
  delta: string
}

export interface ChatDone {
  sessionId: string
}

export interface ChatError {
  sessionId: string
  message: string
  code?:
    | 'no-key'
    | 'no-base-url'
    | 'no-model'
    | 'no-vision-model'
    | 'image-unreadable'
    | 'auth'
    | 'rate-limit'
    | 'server'
    | 'network'
    | 'http'
    | 'unknown'
}

export interface RouletteApi {
  onWheelShow(cb: (p: WheelShowPayload) => void): () => void
  onWheelMove(cb: (p: WheelMovePayload) => void): () => void
  onWheelResult(cb: (r: WheelResult) => void): () => void
  onPanelOpen(cb: (p: PanelOpenPayload) => void): () => void
  onOpenHistory(cb: () => void): () => void
  selectSector(sector: Sector): void
  cancelWheel(): void
  closePanel(): void
  copyText(text: string): void
  insertText(text: string): void
  onInsertFailed(cb: () => void): () => void
  getSettings(): Promise<AppSettings>
  getApiKey(): Promise<string>
  saveSettings(input: SettingsInput): Promise<AppSettings>
  listSessions(): Promise<SessionSummary[]>
  getSession(id: string): Promise<SessionDetail | null>
  deleteSession(id: string): Promise<SessionSummary[]>
  renameSession(id: string, title: string): Promise<SessionSummary[]>
  chat(request: ChatRequest): void
  cancelChat(sessionId: string): void
  onChatDelta(cb: (d: ChatDelta) => void): () => void
  onChatDone(cb: (d: ChatDone) => void): () => void
  onChatError(cb: (e: ChatError) => void): () => void
  captureScreenshot(): void
  onPanelAttach(cb: (p: { image: string }) => void): () => void
  onShotShow(cb: (p: ShotShowPayload) => void): () => void
  completeShot(payload: ShotCompletePayload): void
  cancelShot(): void
  getAsrStatus(): Promise<AsrStatus>
  downloadAsrModel(): Promise<AsrStatus>
  onAsrProgress(cb: (status: AsrStatus) => void): () => void
  transcribe(request: TranscribeRequest): Promise<AsrResult>
  onTestStopRecording(cb: () => void): () => void
}

export type HookEvent =
  | { type: 'ready' }
  | { type: 'ping' }
  | { type: 'down'; x: number; y: number; hwnd: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'up'; x: number; y: number }
  | { type: 'foreground'; hwnd: number; class?: string }
  | { type: 'foreground-query'; hwnd: number; class?: string }
  | { type: 'paste-result'; ok: boolean; method: string; class: string }
  | { type: 'capture-result'; ok: boolean; error?: string }
