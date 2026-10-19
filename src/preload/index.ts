import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  AsrResult,
  AsrStatus,
  ChatDelta,
  ChatDone,
  ChatError,
  ChatRequest,
  KbDocumentSummary,
  KbIngestProgress,
  KbStatus,
  PanelOpenPayload,
  RouletteApi,
  Sector,
  SessionDetail,
  SessionSummary,
  SettingsInput,
  ShotCompletePayload,
  ShotShowPayload,
  TranscribeRequest,
  WheelMovePayload,
  WheelResult,
  WheelShowPayload
} from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: RouletteApi = {
  onWheelShow: (cb) => subscribe<WheelShowPayload>('wheel:show', cb),
  onWheelMove: (cb) => subscribe<WheelMovePayload>('wheel:move', cb),
  onWheelResult: (cb) => subscribe<WheelResult>('wheel:result', cb),
  onPanelOpen: (cb) => subscribe<PanelOpenPayload>('panel:open', cb),
  onOpenHistory: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('panel:history', listener)
    return () => ipcRenderer.removeListener('panel:history', listener)
  },
  selectSector: (sector: Sector) => ipcRenderer.send('wheel:select', sector),
  cancelWheel: () => ipcRenderer.send('wheel:cancel'),
  closePanel: () => ipcRenderer.send('panel:close'),
  minimizePanel: () => ipcRenderer.send('panel:minimize'),
  copyText: (text: string) => ipcRenderer.send('clipboard:write', text),
  insertText: (text: string) => ipcRenderer.send('panel:insert', text),
  onInsertFailed: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('insert:failed', listener)
    return () => ipcRenderer.removeListener('insert:failed', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  getApiKey: () => ipcRenderer.invoke('settings:key') as Promise<string>,
  saveSettings: (input: SettingsInput) =>
    ipcRenderer.invoke('settings:save', input) as Promise<AppSettings>,
  listSessions: () => ipcRenderer.invoke('history:list') as Promise<SessionSummary[]>,
  getSession: (id: string) =>
    ipcRenderer.invoke('history:get', id) as Promise<SessionDetail | null>,
  deleteSession: (id: string) =>
    ipcRenderer.invoke('history:delete', id) as Promise<SessionSummary[]>,
  renameSession: (id: string, title: string) =>
    ipcRenderer.invoke('history:rename', id, title) as Promise<SessionSummary[]>,
  chat: (request: ChatRequest) => ipcRenderer.send('chat:start', request),
  cancelChat: (sessionId: string) => ipcRenderer.send('chat:cancel', sessionId),
  onChatDelta: (cb) => subscribe<ChatDelta>('chat:delta', cb),
  onChatDone: (cb) => subscribe<ChatDone>('chat:done', cb),
  onChatError: (cb) => subscribe<ChatError>('chat:error', cb),
  captureScreenshot: () => ipcRenderer.send('panel:capture'),
  onPanelAttach: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: { image: string }): void =>
      cb(payload)
    ipcRenderer.on('panel:attach', listener)
    return () => ipcRenderer.removeListener('panel:attach', listener)
  },
  onShotShow: (cb) => subscribe<ShotShowPayload>('shot:show', cb),
  completeShot: (payload: ShotCompletePayload) =>
    ipcRenderer.send('shot:complete', payload),
  cancelShot: () => ipcRenderer.send('shot:cancel'),
  getAsrStatus: () => ipcRenderer.invoke('asr:status') as Promise<AsrStatus>,
  downloadAsrModel: () => ipcRenderer.invoke('asr:download') as Promise<AsrStatus>,
  onAsrProgress: (cb) => subscribe<AsrStatus>('asr:progress', cb),
  transcribe: (request: TranscribeRequest) =>
    ipcRenderer.invoke('asr:transcribe', request) as Promise<AsrResult>,
  getKbStatus: () => ipcRenderer.invoke('kb:status') as Promise<KbStatus>,
  prepareKb: () => ipcRenderer.invoke('kb:prepare') as Promise<KbStatus>,
  listKbDocuments: () =>
    ipcRenderer.invoke('kb:documents') as Promise<KbDocumentSummary[]>,
  addKbText: (input: { title: string; text: string }) =>
    ipcRenderer.invoke('kb:add-text', input) as Promise<KbDocumentSummary | null>,
  addKbFiles: () =>
    ipcRenderer.invoke('kb:add-files') as Promise<KbDocumentSummary[]>,
  deleteKbDocument: (id: number) =>
    ipcRenderer.invoke('kb:delete', id) as Promise<KbDocumentSummary[]>,
  onKbProgress: (cb) => subscribe<KbStatus>('kb:progress', cb),
  onKbIngestProgress: (cb) => subscribe<KbIngestProgress>('kb:ingest', cb),
  onTestStopRecording: (cb) => subscribe<void>('test:stop-recording', cb)
}

contextBridge.exposeInMainWorld('roulette', api)
