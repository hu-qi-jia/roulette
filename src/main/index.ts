import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  Tray,
  type Display,
  type WebContents
} from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HookClient } from './hook-client'
import { downloadModel, getAsrStatus, transcribe } from './asr'
import {
  getKbStatus,
  ingestFiles,
  ingestText,
  prepareKb,
  retrieveKb,
  setKbIngestSink,
  setKbProgressSink
} from './kb'
import { streamChat } from './engine'
import {
  buildWebContext,
  searchWeb,
  supportsHostWebSearch
} from './websearch'
import {
  getApiKey,
  getBubblePosition,
  getPublicSettings,
  saveSettings,
  setAlwaysOnTopSetting,
  setBubblePosition
} from './settings'
import {
  cloneShortcuts,
  DEFAULT_SHORTCUTS,
  describeBinding,
  mouseButtonCode,
  toAccelerator,
  toHookConfig,
  validateShortcuts
} from '../shared/shortcuts'
import {
  appendMessage,
  closeStore,
  deleteKbDocument,
  deleteSession,
  deleteTrailingAssistant,
  ensureSession,
  getMessages,
  getSession,
  listKbDocuments,
  listSessions,
  openStore,
  renameSession,
  sessionHasImages
} from './store'
import {
  BUBBLE_SIZE,
  createBubbleWindow,
  createDragWindow,
  createOverlayWindow,
  createPanelWindow,
  createShotWindow,
  OVERLAY_SIZE,
  setOverlayInteractive
} from './windows'
import type {
  ChatMessage,
  ChatRequest,
  HookEvent,
  KbSource,
  Sector,
  SessionKind,
  SettingsInput,
  ShotCompletePayload,
  ShotDisplay,
  ShotShowPayload,
  ShortcutAction,
  ShortcutInfo,
  ShortcutSettings,
  StoredMessage,
  TranscribeRequest,
  WheelMode,
  WheelResult
} from '../shared/types'

const DEAD_ZONE = 76
const SHOT_ESCAPE = 'Escape'

// Set ROULETTE_PERF=1 to log startup and pipeline timings to the console.
const PERF = process.env.ROULETTE_PERF === '1'
const PERF_ORIGIN = performance.now()

function perf(label: string, detail?: unknown): void {
  if (!PERF) return
  const elapsed = Math.round(performance.now() - PERF_ORIGIN)
  if (detail === undefined) console.log(`[perf] ${label}: ${elapsed}ms`)
  else console.log(`[perf] ${label}: ${elapsed}ms`, detail)
}

// Dev-only: feed a WAV file to getUserMedia so the voice flow can be tested
// on machines without a microphone.
if (process.env.ROULETTE_TEST_MIC_WAV) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch(
    'use-file-for-fake-audio-capture',
    process.env.ROULETTE_TEST_MIC_WAV
  )
}
const KIND_BY_SECTOR: Record<Sector, SessionKind> = {
  text: 'chat',
  screenshot: 'screenshot',
  voice: 'voice',
  history: 'chat'
}

let overlay: BrowserWindow | null = null
let panel: BrowserWindow | null = null
let shot: BrowserWindow | null = null
let bubble: BrowserWindow | null = null
let bubbleTimer: NodeJS.Timeout | null = null
let tray: Tray | null = null
let trayInteractedAt = 0
let quitting = false
let dragGhost: BrowserWindow | null = null
let dragGhostPending: string | null = null
let dragGhostWarmTimer: NodeJS.Timeout | null = null
/** Non-null while the native hook is tracking a text drag. */
let textDrag: { text: string } | null = null
const hook = new HookClient()

let active = false
let mode: WheelMode = 'hold'
let center = { x: 0, y: 0 }
let wheelOrigin = { x: 0, y: 0 }
let hideTimer: NodeJS.Timeout | null = null
let targetHwnd = 0
let shotActive = false
let shotFromPanel = false
let pendingShot: ShotShowPayload | null = null
let lastWheelHovered: WheelResult | null = null
let panelShowPending = false
let panelShowTimer: NodeJS.Timeout | null = null
let shotStartedAt = 0
let clickShortcut: string | null = null
let historyShortcut: string | null = null
let activeShortcuts: ShortcutSettings = cloneShortcuts(DEFAULT_SHORTCUTS)
let shortcutActive: Record<ShortcutAction, string | null> = {
  hold: null,
  click: null,
  history: null
}
let shortcutErrors: Partial<Record<ShortcutAction, string>> = {}
let shortcutCapture = false
let panelPinned = true
let dialogOpen = false
/** True while a synthetic paste owns the foreground; the panel must not
 *  auto-minimize when the target window activates. */
let pasteActive = false
const activeChats = new Map<string, AbortController>()

function toDip(x: number, y: number): { x: number; y: number } {
  if (typeof screen.screenToDipPoint === 'function') {
    try {
      const p = screen.screenToDipPoint({ x, y })
      return { x: p.x, y: p.y }
    } catch {
      // Fall back to the display scale factor below.
    }
  }
  const display = screen.getDisplayNearestPoint({ x, y })
  const scale = display.scaleFactor || 1
  return { x: x / scale, y: y / scale }
}

function toPhysical(point: { x: number; y: number }): { x: number; y: number } {
  try {
    return screen.dipToScreenPoint(point)
  } catch {
    return point
  }
}

function hookPath(): string {
  const name = process.platform === 'win32' ? 'roulette-hook.exe' : 'roulette-hook'
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'native')
    : path.join(app.getAppPath(), 'native', 'mouse-hook', 'target', 'release')
  return path.join(base, name)
}

function sectorForAngle(angle: number): Sector {
  // 0° = right, 90° = down, 180° = left, 270° = up.
  if (angle >= 225 && angle < 315) return 'text'
  if (angle >= 135 && angle < 225) return 'screenshot'
  if (angle >= 45 && angle < 135) return 'history'
  return 'voice'
}

function sendToOverlay(channel: string, payload?: unknown): void {
  if (!overlay || overlay.webContents.isLoading()) return
  overlay.webContents.send(channel, payload)
}

function sendToPanel(channel: string, payload?: unknown): void {
  if (!panel || panel.webContents.isLoading()) return
  panel.webContents.send(channel, payload)
}

function applyPanelPin(pinned: boolean): void {
  panelPinned = pinned
  panel?.setAlwaysOnTop(pinned, 'floating')
  console.log('[panel] always on top:', pinned)
}

/** Unpinned panels behave like ordinary windows and get out of the way when
 *  another app is activated. Native drags, dialogs, the launcher and the tray
 *  keep it open. */
function minimizePanelIfUnpinned(): void {
  setTimeout(() => {
    if (panelPinned || !panel || panel.isMinimized() || !panel.isVisible()) return
    if (textDrag || shotActive || dialogOpen || pasteActive) return
    if (panel.isFocused() || bubble?.isFocused()) return
    // Clicking the tray blurs the panel; do not race the tray's own toggle.
    if (Date.now() - trayInteractedAt < 800) return
    console.log('[panel] minimizing (unpinned)')
    panel.minimize()
  }, 120)
}

function bubbleDefaultPosition(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - BUBBLE_SIZE - 24,
    y: area.y + area.height - BUBBLE_SIZE - 24
  }
}

/** Keep the whole launcher on a display, even after a DPI or layout change. */
function clampBubblePosition(point: { x: number; y: number }): { x: number; y: number } {
  const area = screen.getDisplayNearestPoint({
    x: Math.round(point.x + BUBBLE_SIZE / 2),
    y: Math.round(point.y + BUBBLE_SIZE / 2)
  }).workArea
  return {
    x: Math.round(Math.min(Math.max(point.x, area.x + 8), area.x + area.width - BUBBLE_SIZE - 8)),
    y: Math.round(Math.min(Math.max(point.y, area.y + 8), area.y + area.height - BUBBLE_SIZE - 8))
  }
}

/** Created once, shortly after startup, so it never delays the first paint. */
function ensureBubble(): void {
  if (bubble) return
  const saved = getBubblePosition()
  const at = saved ? clampBubblePosition(saved) : bubbleDefaultPosition()
  const win = createBubbleWindow(at)
  bubble = win
  win.webContents.on('did-finish-load', () => {
    if (bubble !== win) return
    win.showInactive()
    console.log('[bubble] ready')
    captureIfRequested(win, 'out/bubble-capture.png')
  })
  win.on('closed', () => {
    if (bubble === win) bubble = null
  })
  // The launcher has no close affordance; Alt+F4 should leave it in place.
  keepWindowResident(win, () => {})
}

function scheduleBubble(): void {
  if (bubble || bubbleTimer) return
  bubbleTimer = setTimeout(() => {
    bubbleTimer = null
    ensureBubble()
  }, 1500)
  bubbleTimer.unref?.()
}

/** Hide to the tray and end the current turn. Minimize (the header button)
 *  keeps the turn running; close/hide does not leave a hidden stream behind. */
function hidePanel(): void {
  cancelTextDrag()
  for (const controller of activeChats.values()) controller.abort()
  activeChats.clear()
  panel?.hide()
}

/** The launcher and tray click toggle: visible -> minimize, minimized/hidden -> show. */
function togglePanelFromLauncher(): void {
  if (!panel) return
  console.log('[launcher] toggle')
  if (panel.isMinimized()) {
    panel.restore()
    panel.focus()
    return
  }
  if (panel.isVisible()) {
    panel.minimize()
    return
  }
  openPanel('text')
}

/** Tray menu "open": never minimizes a panel that is already on screen. */
function showPanelFromLauncher(): void {
  if (!panel) return
  if (panel.isMinimized()) {
    panel.restore()
    panel.focus()
    return
  }
  if (panel.isVisible()) {
    panel.focus()
    return
  }
  openPanel('text')
}

function trayIconPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, 'resources', 'tray.png')
}

function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(trayIconPath())
  if (icon.isEmpty()) {
    console.warn('[tray] icon not found:', trayIconPath())
    return
  }
  tray = new Tray(icon)
  tray.setToolTip('Roulette')
  const zh = app.getLocale().toLowerCase().startsWith('zh')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: zh ? '打开轮盘' : 'Open Roulette',
        click: showPanelFromLauncher
      },
      {
        label: zh ? '隐藏面板' : 'Hide panel',
        click: hidePanel
      },
      { type: 'separator' },
      {
        label: zh ? '退出' : 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => {
    trayInteractedAt = Date.now()
    togglePanelFromLauncher()
  })
  tray.on('right-click', () => {
    trayInteractedAt = Date.now()
  })
  console.log('[tray] ready')
}

/** Alt+F4 and other close paths hide resident windows instead of destroying
 *  them, so the tray and the global hook keep working. */
function keepWindowResident(win: BrowserWindow, onClose: () => void): void {
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    onClose()
  })
}

function emitChatError(
  sessionId: string,
  message: string,
  code?: 'no-key' | 'no-base-url' | 'no-model' | 'no-vision-model' | 'image-unreadable' | 'auth' | 'rate-limit' | 'server' | 'network' | 'http' | 'unknown'
): void {
  sendToPanel('chat:error', { sessionId, message, code })
}

function classifyEngineError(error: unknown): 'auth' | 'rate-limit' | 'server' | 'network' | 'http' | 'unknown' {
  const message = error instanceof Error ? error.message : String(error)
  if (/HTTP 401|HTTP 403/i.test(message)) return 'auth'
  if (/HTTP 429/i.test(message)) return 'rate-limit'
  if (/HTTP 5\d\d/i.test(message)) return 'server'
  if (/HTTP \d+/i.test(message)) return 'http'
  if (/fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|timeout/i.test(message)) return 'network'
  return 'unknown'
}

const MAX_IMAGE_DATA_URL = 24 * 1024 * 1024

/** Persists a capture and returns its path. Images never leave the machine
 *  except as part of a request to the configured provider. */
function saveImage(dataUrl: string): string | null {
  if (dataUrl.length > MAX_IMAGE_DATA_URL) return null
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) return null

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  try {
    const dir = path.join(app.getPath('userData'), 'images')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${Date.now()}-${crypto.randomUUID()}.${ext}`)
    fs.writeFileSync(file, Buffer.from(match[2], 'base64'))
    return file
  } catch (error) {
    console.warn('[image] save failed', error)
    return null
  }
}

const IMAGE_CACHE_MAX_ENTRIES = 8
const IMAGE_CACHE_MAX_CHARS = 24 * 1024 * 1024
const imageDataCache = new Map<string, { dataUrl: string; size: number }>()
let imageDataCacheSize = 0

/** Chat images are written once under a unique name, so a small bounded LRU
 *  avoids re-reading and re-encoding them on every follow-up turn. */
function readImageDataUrl(file: string): string | null {
  const cached = imageDataCache.get(file)
  if (cached) {
    imageDataCache.delete(file)
    imageDataCache.set(file, cached)
    return cached.dataUrl
  }
  try {
    const ext = path.extname(file).slice(1).toLowerCase()
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
    imageDataCache.set(file, { dataUrl, size: dataUrl.length })
    imageDataCacheSize += dataUrl.length
    while (
      imageDataCache.size > IMAGE_CACHE_MAX_ENTRIES ||
      imageDataCacheSize > IMAGE_CACHE_MAX_CHARS
    ) {
      const oldest = imageDataCache.keys().next().value
      if (oldest === undefined) break
      const entry = imageDataCache.get(oldest)
      imageDataCache.delete(oldest)
      imageDataCacheSize -= entry?.size ?? 0
    }
    return dataUrl
  } catch {
    return null
  }
}

function toChatHistory(messages: StoredMessage[]): ChatMessage[] {
  const started = PERF ? performance.now() : 0
  let images = 0
  const history = messages.map((message) => {
    const image = message.imagePath ? readImageDataUrl(message.imagePath) : null
    if (image) images += 1
    return {
      role: message.role,
      content: message.content,
      images: image ? [image] : undefined
    }
  })
  if (PERF && images > 0) {
    perf(
      'chat history',
      `messages=${messages.length} images=${images} ${Math.round(performance.now() - started)}ms`
    )
  }
  return history
}

async function retrieveKbWithTimeout(query: string): Promise<KbSource[]> {
  // Knowledge-base retrieval is optional context. Never let embedding/load
  // latency hold up the model's own answer.
  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<KbSource[]>((resolve) => {
    timer = setTimeout(() => {
      console.warn('[kb] retrieval timed out; answering without it')
      resolve([])
    }, 1200)
  })
  try {
    return await Promise.race([retrieveKb(query), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function handleChat(request: ChatRequest): Promise<void> {
  const settings = getPublicSettings()
  const apiKey = getApiKey()

  if (!apiKey) {
    emitChatError(request.sessionId, 'API key is not configured.', 'no-key')
    return
  }
  if (!settings.baseUrl) {
    emitChatError(request.sessionId, 'Base URL is not configured.', 'no-base-url')
    return
  }

  const text = String(request.text ?? '').trim()
  if (!text) return

  // A screenshot session keeps using the vision model for follow-up turns,
  // because the earlier turn still carries its image. Check the stored path
  // first so this does not decode every image twice.
  const needsVision =
    Boolean(request.image) || sessionHasImages(request.sessionId)
  const model = needsVision ? settings.visionModel : settings.textModel
  if (!model) {
    emitChatError(
      request.sessionId,
      needsVision ? 'Vision model is not configured.' : 'Text model is not configured.',
      needsVision ? 'no-vision-model' : 'no-model'
    )
    return
  }

  let imagePath: string | null = null
  const saveRequestImage = (): boolean => {
    if (!request.image) return true
    imagePath = saveImage(request.image)
    if (!imagePath) {
      emitChatError(request.sessionId, 'The attached image could not be read.', 'image-unreadable')
      return false
    }
    return true
  }

  ensureSession({
    id: request.sessionId,
    kind: request.kind,
    appName: request.appName ?? null
  })
  if (request.retry) {
    // Regenerate the last answer: drop it from history, but keep the user
    // message that prompted it so the model sees the same turn.
    deleteTrailingAssistant(request.sessionId, text)
    const stored = getMessages(request.sessionId)
    const last = stored[stored.length - 1]
    // The user turn is normally already stored. It is missing when the first
    // attempt failed before reaching the store (for example, no API key).
    if (!last || last.role !== 'user' || last.content !== text) {
      if (!saveRequestImage()) return
      appendMessage(request.sessionId, 'user', text, imagePath)
    }
  } else {
    if (!saveRequestImage()) return
    appendMessage(request.sessionId, 'user', text, imagePath)
  }
  // The store is the single source of truth for the conversation, so a resumed
  // session can continue with its full history.
  const history = toChatHistory(getMessages(request.sessionId))

  let sources: KbSource[] = []
  const hostWebSearch =
    settings.webSearch && supportsHostWebSearch(settings.baseUrl)
  // Start local retrieval in parallel, but if the web search finds results we
  // do not wait for the knowledge base at all.
  const kbPromise = settings.kbEnabled
    ? retrieveKbWithTimeout(text)
    : Promise.resolve([] as KbSource[])
  const webResults = hostWebSearch
    ? await searchWeb(settings.baseUrl, apiKey, text)
    : []

  let systemContext: string | undefined
  if (webResults.length > 0) {
    // Web results are current and already carry citable URLs. Do not mix in
    // knowledge-base sources, whose [n] numbering would collide.
    systemContext = buildWebContext(webResults, text)
    sources = []
    console.log('[web] retrieved', webResults.length, 'results for', request.sessionId)
  } else {
    sources = await kbPromise
    if (sources.length > 0) {
      systemContext = buildKbContext(sources)
      console.log('[kb] retrieved', sources.length, 'chunks for', request.sessionId)
    } else if (hostWebSearch) {
      systemContext =
        'A web search was attempted for the latest question but returned no usable results. Answer normally from your own knowledge and note that time-sensitive facts may be outdated.'
    }
  }

  // Non-DeepSeek providers use their own search capability, if any.
  const modelWebSearch = settings.webSearch && !hostWebSearch

  activeChats.get(request.sessionId)?.abort()
  const controller = new AbortController()
  activeChats.set(request.sessionId, controller)
  let received = 0
  let output = ''
  // Providers emit tokens much faster than a screen refresh. Coalesce deltas
  // into one IPC message per frame so the renderer does not re-render the
  // conversation for every token.
  let pendingDelta = ''
  let flushTimer: NodeJS.Timeout | null = null
  const flushDelta = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (!pendingDelta) return
    const delta = pendingDelta
    pendingDelta = ''
    sendToPanel('chat:delta', { sessionId: request.sessionId, delta })
  }

  try {
    console.log('[chat] start', request.sessionId, 'turns:', history.length, 'model:', model)
    for await (const delta of streamChat(
      {
        baseUrl: settings.baseUrl,
        apiKey,
        model,
        webSearch: modelWebSearch,
        systemContext
      },
      history,
      controller.signal
    )) {
      received += delta.length
      output += delta
      pendingDelta += delta
      if (!flushTimer) flushTimer = setTimeout(flushDelta, 16)
    }
    flushDelta()
    console.log('[chat] done', request.sessionId, 'chars:', received)
    sendToPanel('chat:done', { sessionId: request.sessionId, sources })
    if (panel) captureIfRequested(panel, 'out/chat-capture.png')
    if (process.env.ROULETTE_TEST_INSERT === '1' && output) {
      void insertText(output)
    }
  } catch (error) {
    // A newer request for this session already owns the UI; drop its buffer.
    if (activeChats.get(request.sessionId) !== controller) {
      pendingDelta = ''
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
    } else {
      flushDelta()
    }
    console.warn('[chat] error', error)
    if (panel) captureIfRequested(panel, 'out/chat-error-capture.png')
    if (controller.signal.aborted) {
      sendToPanel('chat:done', { sessionId: request.sessionId, sources })
    } else {
      emitChatError(
        request.sessionId,
        error instanceof Error ? error.message : String(error),
        classifyEngineError(error)
      )
    }
  } finally {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    // A newer request for the same session already replaced this one; its
    // partial output must not land after the newer user message.
    const active = activeChats.get(request.sessionId)
    const superseded = active !== undefined && active !== controller
    if (active === controller) {
      flushDelta()
      activeChats.delete(request.sessionId)
    }
    // Keep partial output on cancellation so a resumed session stays coherent.
    if (output.trim() && !superseded) {
      const meta = sources.length > 0 ? JSON.stringify({ sources }) : null
      appendMessage(request.sessionId, 'assistant', output.trim(), null, meta)
    }
  }
}

function buildKbContext(sources: KbSource[]): string {
  const lines = sources.map(
    (source, index) => `[${index + 1}] ${source.title}\n${source.snippet}`
  )
  return `The passages below are optional reference material from the user's local knowledge base. Use them only when they are relevant to the question. If they are unrelated, incomplete, or do not help, ignore them completely and answer normally from your own knowledge; do not mention the knowledge base or any missing information. Do not copy passages wholesale. When you use a passage, cite it as [1], [2], etc.\n\n${lines.join('\n\n')}`
}

// Electron 44's async clipboard API refuses to write ClipboardItems returned by
// clipboard.read(), so v1 snapshots and restores plain text only.
async function snapshotClipboard(): Promise<string> {
  try {
    return await clipboard.readText()
  } catch {
    return ''
  }
}

async function restoreClipboard(text: string): Promise<void> {
  try {
    // If the clipboard was empty before, leave the inserted text in place:
    // clearing it risks racing a slow paste and gives the user nothing to re-paste.
    if (text) await clipboard.writeText(text)
  } catch (error) {
    console.warn('[insert] clipboard restore failed', error)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function windowHandle(win: BrowserWindow | null): number {
  if (!win) return 0
  try {
    const buffer = win.getNativeWindowHandle()
    return buffer.length >= 8 ? Number(buffer.readBigUInt64LE(0)) : buffer.readUInt32LE(0)
  } catch {
    return 0
  }
}

function isOurWindow(hwnd: number): boolean {
  if (!hwnd) return false
  return [panel, overlay, shot, bubble, dragGhost].some(
    (win) => windowHandle(win) === hwnd
  )
}

const DESKTOP_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Windows.UI.Core.CoreWindow'
])

async function queryForeground(
  timeoutMs = 700
): Promise<{ hwnd: number; className: string } | null> {
  if (!hook.isRunning()) return null
  const waiter = hook.waitFor((event) => event.type === 'foreground-query', timeoutMs)
  if (!hook.send('query-foreground')) {
    void waiter.catch(() => {})
    return null
  }
  try {
    const event = await waiter
    if (event.type === 'foreground-query') {
      return { hwnd: event.hwnd, className: event.class ?? '' }
    }
  } catch {
    // The query timed out; fall back to the locked target.
  }
  return null
}

async function insertText(text: string): Promise<void> {
  if (!text.trim()) return
  console.log('[insert] start target:', targetHwnd, 'hook:', hook.isRunning(), 'chars:', text.length)

  // Keep the panel on screen and out of the auto-minimize path; only its
  // foreground is released so the previous app can receive the paste.
  pasteActive = true
  try {
    if (!hook.isRunning()) {
      console.warn('[insert] hook is not running; copying instead')
      await clipboard.writeText(text)
      revealPanel()
      sendToPanel('insert:failed')
      return
    }

    const snapshot = await snapshotClipboard()
    console.log('[insert] snapshot chars:', snapshot.length)
    await clipboard.writeText(text)
    console.log('[insert] clipboard written')

    panel?.blur()
    // Let the OS hand the foreground back without hiding the panel.
    await delay(60)

    // Prefer the window that is foreground right now over the window that was
    // under the cursor when the wheel opened: the user may have switched apps.
    let pasteTarget = targetHwnd
    const foreground = await queryForeground(700)
    if (
      foreground &&
      foreground.hwnd &&
      !isOurWindow(foreground.hwnd) &&
      !DESKTOP_CLASSES.has(foreground.className)
    ) {
      pasteTarget = foreground.hwnd
    }
    console.log('[insert] target:', pasteTarget, 'foreground:', foreground)

    const command =
      process.env.ROULETTE_TEST_WMPASTE === '1'
        ? `wmpaste ${pasteTarget}`
        : `paste ${pasteTarget} ${Math.round(wheelOrigin.x)} ${Math.round(wheelOrigin.y)}`
    const resultPromise = hook.waitFor((event) => event.type === 'paste-result', 5000)
    const sent = hook.send(command)
    console.log('[insert] command sent:', command, sent)
    if (!sent) {
      await clipboard.writeText(text)
      revealPanel()
      sendToPanel('insert:failed')
      return
    }

    const result = await resultPromise.catch((error) => {
      console.warn('[insert] no paste result', error)
      return null
    })
    console.log('[insert] result', result)

    if (!result || result.type !== 'paste-result' || !result.ok) {
      // Keep the text on the clipboard and tell the user to paste manually.
      await clipboard.writeText(text)
      revealPanel()
      sendToPanel('insert:failed')
      return
    }

    await delay(250)
    await restoreClipboard(snapshot)
    console.log('[insert] pasted', text.length, 'chars to', pasteTarget)

    if (process.env.ROULETTE_TEST_SIDEKEY === '1') {
      const keySent = hook.send('key')
      console.log('[test] side key sent:', keySent)
    }
  } catch (error) {
    console.error('[insert] failed', error)
    await clipboard.writeText(text).catch(() => {})
    revealPanel()
    sendToPanel('insert:failed')
  } finally {
    pasteActive = false
  }
}

const DRAG_GHOST_WIDTH = 320
const DRAG_GHOST_HEIGHT = 104

function ensureDragGhost(): BrowserWindow {
  if (dragGhost) return dragGhost
  const win = createDragWindow()
  dragGhost = win
  win.webContents.on('did-finish-load', () => {
    if (dragGhost !== win || dragGhostPending === null) return
    win.webContents.send('drag:text', dragGhostPending)
  })
  keepWindowResident(win, cleanupTextDrag)
  return win
}

/** Load the preview window in the background so the first drag is instant. */
function warmDragGhost(): void {
  if (dragGhost || dragGhostWarmTimer) return
  dragGhostWarmTimer = setTimeout(() => {
    dragGhostWarmTimer = null
    ensureDragGhost()
  }, 250)
  dragGhostWarmTimer.unref?.()
}

function positionDragGhost(point: { x: number; y: number }): void {
  if (!dragGhost) return
  const area = screen.getDisplayNearestPoint(point).workArea
  const x = Math.min(
    Math.max(point.x + 18, area.x + 8),
    area.x + area.width - DRAG_GHOST_WIDTH - 8
  )
  const y = Math.min(
    Math.max(point.y + 20, area.y + 8),
    area.y + area.height - DRAG_GHOST_HEIGHT - 8
  )
  dragGhost.setPosition(Math.round(x), Math.round(y), false)
}

function showDragGhost(text: string): void {
  const win = ensureDragGhost()
  const preview = text.length > 280 ? `${text.slice(0, 280)}…` : text
  dragGhostPending = preview
  if (!win.webContents.isLoading()) win.webContents.send('drag:text', preview)
  positionDragGhost(screen.getCursorScreenPoint())
  if (!win.isVisible()) win.showInactive()
  captureIfRequested(win, 'out/drag-ghost-capture.png')
}

function cleanupTextDrag(): void {
  textDrag = null
  dragGhost?.hide()
  sendToPanel('drag:state', false)
}

function beginTextDrag(text: string): void {
  if (textDrag) return
  const value = String(text ?? '')
  if (!value.trim()) return
  console.log('[drag] begin chars:', value.length)
  if (!hook.isRunning()) {
    sendToPanel('drag:state', false)
    return
  }
  textDrag = { text: value }
  // Start loading the preview immediately so the first drag is not delayed.
  ensureDragGhost()
  if (!hook.send('dragstart')) cleanupTextDrag()
}

function cancelTextDrag(): void {
  if (!textDrag) return
  console.log('[drag] cancel')
  hook.send('dragcancel')
  cleanupTextDrag()
}

function pointInWindow(
  win: BrowserWindow | null,
  point: { x: number; y: number }
): boolean {
  if (!win || !win.isVisible()) return false
  const bounds = win.getBounds()
  return (
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x < bounds.x + bounds.width &&
    point.y < bounds.y + bounds.height
  )
}

/** Drops text at a physical screen point. The native helper resolves the
 *  window under that point, focuses it, clicks to place the caret, and pastes. */
async function dropTextAt(text: string, x: number, y: number): Promise<void> {
  const started = Date.now()
  console.log('[drag] drop at', Math.round(x), Math.round(y), 'chars:', text.length)
  pasteActive = true
  const fail = async (): Promise<void> => {
    await clipboard.writeText(text).catch(() => {})
    revealPanel()
    sendToPanel('insert:failed')
  }

  try {
    if (!hook.isRunning()) {
      await fail()
      return
    }

    const snapshot = await snapshotClipboard()
    await clipboard.writeText(text)

    const resultPromise = hook.waitFor((event) => event.type === 'paste-result', 5000)
    const sent = hook.send(`dropat ${Math.round(x)} ${Math.round(y)}`)
    if (!sent) {
      void resultPromise.catch(() => {})
      await fail()
      return
    }

    const result = await resultPromise.catch((error) => {
      console.warn('[drag] no paste result', error)
      return null
    })
    if (!result || result.type !== 'paste-result' || !result.ok) {
      console.warn('[drag] paste failed', result)
      await fail()
      return
    }

    await delay(250)
    await restoreClipboard(snapshot)
    console.log('[drag] pasted', text.length, 'chars in', Date.now() - started, 'ms')
  } catch (error) {
    console.error('[drag] failed', error)
    await fail()
  } finally {
    pasteActive = false
  }
}

function captureIfRequested(win: BrowserWindow, name: string): void {
  if (process.env.ROULETTE_CAPTURE !== '1') return
  setTimeout(() => {
    win.webContents
      .capturePage()
      .then((image) => fs.writeFileSync(path.join(app.getAppPath(), name), image.toPNG()))
      .catch((error) => console.warn('[capture]', error))
  }, 500)
}

function maybeRunTestMessage(): void {
  const text = process.env.ROULETTE_TEST_MESSAGE
  if (!text || !panel) return
  setTimeout(() => {
    if (!panel) return
    const script = `(() => {
      const el = document.querySelector('textarea');
      if (!(el instanceof HTMLTextAreaElement)) return 'no-textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
      setTimeout(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }, 120);
      return 'queued';
    })()`
    panel.webContents
      .executeJavaScript(script)
      .then((result) => console.log('[test]', result))
      .catch((error) => console.warn('[test]', error))
  }, 900)
}

// Dev-only: opens the history drawer, resumes the first entry, and reports what
// the panel rendered. Relies on the panel's DOM structure; not shipped UI code.
function maybeRunHistoryTest(): void {
  if (process.env.ROULETTE_TEST_HISTORY !== '1' || !panel) return
  setTimeout(() => {
    if (!panel) return
    const followup = process.env.ROULETTE_TEST_FOLLOWUP ?? ''
    const script = `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelector('.history-button')?.click();
      await wait(500);
      const items = document.querySelectorAll('.history-item');
      const listCount = items.length;
      items[0]?.click();
      await wait(500);
      const resumed = {
        renderedMessages: document.querySelectorAll('.message').length,
        title: document.querySelector('.session-title')?.textContent ?? '',
        bubble: document.querySelector('.message.user .bubble')?.textContent ?? ''
      };
      const followup = ${JSON.stringify(followup)};
      if (followup) {
        const el = document.querySelector('textarea');
        if (el instanceof HTMLTextAreaElement) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(el, followup);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.focus();
          await wait(120);
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await wait(1800);
        }
      }
      return {
        listCount,
        resumed,
        afterFollowup: document.querySelectorAll('.message').length
      };
    })()`
    panel.webContents
      .executeJavaScript(script)
      .then((result) => console.log('[test] history', JSON.stringify(result)))
      .catch((error) => console.warn('[test] history', error))
  }, 3500)
}

function showWheel(nextMode: WheelMode, at: { x: number; y: number }): void {
  if (!overlay) return
  if (panel?.isVisible() && !panel.isMinimized()) {
    panel.focus()
    return
  }

  active = true
  mode = nextMode
  center = at
  lastWheelHovered = null
  try {
    wheelOrigin = screen.dipToScreenPoint({ x: at.x, y: at.y })
  } catch {
    wheelOrigin = { x: at.x, y: at.y }
  }

  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  overlay.setBounds({
    x: Math.round(at.x - OVERLAY_SIZE / 2),
    y: Math.round(at.y - OVERLAY_SIZE / 2),
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE
  })
  setOverlayInteractive(overlay, nextMode)
  if (nextMode === 'click') {
    // Ask for the target before the overlay takes the foreground, then show
    // the window a beat later so the query wins the race.
    hook.send('foreground')
    setTimeout(() => {
      if (active && overlay) overlay.show()
    }, 80)
  } else {
    overlay.showInactive()
  }

  sendToOverlay('wheel:show', {
    mode: nextMode,
    size: OVERLAY_SIZE,
    deadZone: DEAD_ZONE
  })
  captureIfRequested(overlay, 'out/overlay-capture.png')
}

function hideWheel(): void {
  active = false
  if (!overlay) return
  const started = PERF ? performance.now() : 0
  // Clear the visible state while hidden so the next show cannot flash the
  // previous sector/selection for a frame before wheel:show arrives.
  sendToOverlay('wheel:hide')
  overlay.hide()
  if (started) perf('overlay.hide()', Math.round(performance.now() - started))
  overlay.setIgnoreMouseEvents(true, { forward: true })
  overlay.setFocusable(false)
}

function finishSelection(result: Sector | 'cancel'): void {
  if (!active) return
  active = false
  console.log('[wheel]', result)
  if (result === 'screenshot') {
    // Skip the result animation; capture as soon as the overlay is hidden.
    hideWheel()
    void startScreenshot(false)
    return
  }
  sendToOverlay('wheel:result', result)
  // Start the panel immediately: its first paint happens under the wheel's
  // result animation, so hiding the wheel reveals an already-rendered window
  // instead of leaving a blank frame (which reads as a stutter).
  if (result === 'history') openPanel('text', { openHistory: true })
  else if (result !== 'cancel') openPanel(result)
  hideTimer = setTimeout(() => {
    hideWheel()
    // The overlay may still own the foreground until it hides. Focus the
    // panel again afterwards so a minimized window reliably comes forward.
    if (result !== 'cancel' && panel?.isVisible() && !panel.isMinimized()) {
      panel.focus()
    }
  }, 200)
}

function toggleClickWheel(): void {
  if (active) {
    finishSelection('cancel')
  } else {
    showWheel('click', screen.getCursorScreenPoint())
  }
}

function openHistoryPanel(): void {
  console.log('[shortcut] history panel')
  if (panel?.isVisible() && !panel.isMinimized()) {
    sendToPanel('panel:history')
    panel.focus()
    return
  }
  openPanel('text', { openHistory: true })
}

function getShortcutInfo(): ShortcutInfo {
  return {
    bindings: cloneShortcuts(activeShortcuts),
    active: { ...shortcutActive },
    errors: { ...shortcutErrors }
  }
}

function sendHookShortcutConfig(): void {
  if (!hook.isRunning()) return
  hook.send(shortcutCapture ? 'config 0 0 0 0 0 0' : toHookConfig(activeShortcuts))
}

function applyShortcuts(next: ShortcutSettings): void {
  activeShortcuts = cloneShortcuts(next)
  shortcutActive = { hold: null, click: null, history: null }
  shortcutErrors = {}

  if (clickShortcut) {
    globalShortcut.unregister(clickShortcut)
    clickShortcut = null
  }
  if (historyShortcut) {
    globalShortcut.unregister(historyShortcut)
    historyShortcut = null
  }

  if (shortcutCapture) {
    sendHookShortcutConfig()
    return
  }

  shortcutErrors = { ...validateShortcuts(activeShortcuts) }

  if (!shortcutErrors.hold) {
    if (hook.isRunning()) {
      shortcutActive.hold = describeBinding(activeShortcuts.hold)
    } else {
      shortcutErrors.hold = 'hook-unavailable'
    }
  }

  for (const action of ['click', 'history'] as const) {
    if (shortcutErrors[action]) continue
    const binding = activeShortcuts[action]
    const accelerator = toAccelerator(binding)
    if (accelerator) {
      try {
        const registered = globalShortcut.register(
          accelerator,
          action === 'click' ? toggleClickWheel : openHistoryPanel
        )
        if (registered) {
          if (action === 'click') clickShortcut = accelerator
          else historyShortcut = accelerator
          shortcutActive[action] = accelerator
        } else {
          shortcutErrors[action] = 'register-failed'
        }
      } catch {
        shortcutErrors[action] = 'register-failed'
      }
    } else if (mouseButtonCode(binding) > 0) {
      shortcutActive[action] = describeBinding(binding)
    } else {
      shortcutErrors[action] = 'invalid'
    }
  }

  sendHookShortcutConfig()
  console.log(
    '[shortcut] applied',
    JSON.stringify({ active: shortcutActive, errors: shortcutErrors })
  )
}

function sendShotShow(payload: ShotShowPayload): void {
  if (!shot) return
  if (shot.webContents.isLoading()) {
    pendingShot = payload
    return
  }
  shot.webContents.send('shot:show', payload)
}

async function captureWithHook(displays: Display[]): Promise<ShotDisplay[] | null> {
  if (!hook.isRunning()) return null
  const outDir = path.join(os.tmpdir(), 'roulette-captures')
  try {
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(outDir, { recursive: true })
  } catch (error) {
    console.warn('[shot] cannot prepare capture dir', error)
    return null
  }

  const items = displays.map((display) => {
    const topLeft = screen.dipToScreenPoint({
      x: display.bounds.x,
      y: display.bounds.y
    })
    const bottomRight = screen.dipToScreenPoint({
      x: display.bounds.x + display.bounds.width,
      y: display.bounds.y + display.bounds.height
    })
    return {
      display,
      rect: {
        x: Math.round(topLeft.x),
        y: Math.round(topLeft.y),
        width: Math.round(bottomRight.x - topLeft.x),
        height: Math.round(bottomRight.y - topLeft.y)
      },
      file: path.join(outDir, `${display.id}.bmp`)
    }
  })

  const command = `capture ${items.length} ${items
    .map(
      (item) =>
        `${item.display.id} ${item.rect.x} ${item.rect.y} ${item.rect.width} ${item.rect.height}`
    )
    .join(' ')}`
  const resultPromise = hook.waitFor((event) => event.type === 'capture-result', 6000)
  const started = Date.now()
  if (!hook.send(command)) {
    void resultPromise.catch(() => {})
    try {
      fs.rmSync(outDir, { recursive: true, force: true })
    } catch {}
    return null
  }

  try {
    const result = await resultPromise
    if (result.type !== 'capture-result' || !result.ok) {
      console.warn('[shot] GDI capture failed', result)
      return null
    }

    const captures: ShotDisplay[] = []
    for (const item of items) {
      if (!fs.existsSync(item.file)) return null
      const bytes = fs.readFileSync(item.file)
      if (bytes.length === 0) return null
      captures.push({
        id: item.display.id,
        bounds: item.display.bounds,
        scaleFactor: item.display.scaleFactor,
        // View the Buffer instead of copying it: a 4K BMP is ~33 MB.
        image: new Uint8Array(
          bytes.buffer as ArrayBuffer,
          bytes.byteOffset,
          bytes.byteLength
        ),
        imageMime: 'image/bmp',
        imageSize: { width: item.rect.width, height: item.rect.height }
      })
    }
    console.log('[shot] GDI capture in', Date.now() - started, 'ms')
    return captures
  } catch (error) {
    console.warn('[shot] GDI capture failed', error)
    return null
  } finally {
    try {
      fs.rmSync(outDir, { recursive: true, force: true })
    } catch {}
  }
}

async function captureWithDesktopCapturer(displays: Display[]): Promise<ShotDisplay[]> {
  const maxWidth = Math.max(
    ...displays.map((display) => Math.round(display.bounds.width * display.scaleFactor))
  )
  const maxHeight = Math.max(
    ...displays.map((display) => Math.round(display.bounds.height * display.scaleFactor))
  )

  const sourcesStarted = Date.now()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight },
    fetchWindowIcons: false
  })
  console.log('[shot] sources in', Date.now() - sourcesStarted, 'ms')

  const encodeStarted = Date.now()
  const captures = displays
    .map((display, index): ShotDisplay | null => {
      const source =
        sources.find((item) => item.display_id === String(display.id)) ??
        sources[index] ??
        sources[0]
      const image = source?.thumbnail
      if (!image || image.isEmpty()) return null
      // JPEG at 90 keeps the frozen overlay light: the crop is exported as
      // JPEG anyway, and a multi-megabyte PNG data URL adds latency.
      const encoded = image.toJPEG(90)
      if (!encoded || encoded.length === 0) return null
      return {
        id: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        image: new Uint8Array(
          encoded.buffer as ArrayBuffer,
          encoded.byteOffset,
          encoded.byteLength
        ),
        imageMime: 'image/jpeg',
        imageSize: image.getSize()
      }
    })
    .filter((item): item is ShotDisplay => item !== null)

  console.log('[shot] encoded in', Date.now() - encodeStarted, 'ms')
  return captures
}

async function startScreenshot(fromPanel: boolean): Promise<void> {
  if (!shot || shotActive) return
  shotActive = true
  shotFromPanel = fromPanel
  shotStartedAt = Date.now()
  const startedAt = shotStartedAt

  try {
    let step = PERF ? performance.now() : 0
    if (fromPanel) panel?.hide()
    if (step) perf('panel.hide()', Math.round(performance.now() - step))
    step = PERF ? performance.now() : 0
    hideWheel()
    if (step) perf('hideWheel', Math.round(performance.now() - step))
    // Let the compositor drop the wheel/panel before grabbing the screen.
    await delay(80)

    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    const displays = [display]
    const virtual = display.bounds
    console.log(
      '[shot] display',
      display.id,
      JSON.stringify(display.bounds),
      'scale',
      display.scaleFactor
    )
    const captureStarted = Date.now()
    const captures =
      (await captureWithHook(displays)) ?? (await captureWithDesktopCapturer(displays))
    console.log('[shot] captured in', Date.now() - captureStarted, 'ms')

    if (captures.length === 0) throw new Error('No screen source returned an image.')

    shot.setBounds(virtual)
    const showStarted = PERF ? performance.now() : 0
    shot.show()
    shot.focus()
    if (showStarted) perf('shot.show()+focus', Math.round(performance.now() - showStarted))
    // If another always-on-top window steals focus, the renderer never sees
    // Escape; a temporary global shortcut keeps cancel working regardless.
    if (!globalShortcut.isRegistered(SHOT_ESCAPE)) {
      console.log(
        '[shot] global escape registered:',
        globalShortcut.register(SHOT_ESCAPE, () => cancelShot())
      )
    }
    sendShotShow({ virtual, displays: captures })
    console.log(
      '[shot] shown in',
      Date.now() - startedAt,
      'ms; focused:',
      BrowserWindow.getFocusedWindow() === shot
    )
  } catch (error) {
    console.error('[shot] capture failed', error)
    shotActive = false
    shotFromPanel = false
    if (globalShortcut.isRegistered(SHOT_ESCAPE)) globalShortcut.unregister(SHOT_ESCAPE)
    if (fromPanel) {
      revealPanel()
    }
  }
}

function finishShot(payload: ShotCompletePayload): void {
  if (!shotActive) return
  shotActive = false
  const hideStarted = PERF ? performance.now() : 0
  shot?.hide()
  if (hideStarted) perf('shot.hide()', Math.round(performance.now() - hideStarted))
  if (globalShortcut.isRegistered(SHOT_ESCAPE)) globalShortcut.unregister(SHOT_ESCAPE)

  const fromPanel = shotFromPanel
  shotFromPanel = false

  if (!payload.image || !payload.image.startsWith('data:image/')) return

  console.log('[shot] selected', payload.width, 'x', payload.height, 'fromPanel:', fromPanel)

  if (fromPanel) {
    if (!panel) return
    const started = PERF ? performance.now() : 0
    const wasVisible = panel.isVisible()
    if (!panel.webContents.isLoading()) {
      panel.webContents.send('panel:attach', { image: payload.image })
    }
    if (wasVisible) {
      setImmediate(() => {
        if (!panel) return
        panel.focus()
      })
    } else {
      schedulePanelShow()
    }
    if (started) {
      perf(`panel:attach sent ${Math.round(performance.now() - started)}ms`, {
        imageChars: payload.image.length
      })
    }
    if (panel) captureIfRequested(panel, 'out/panel-attach-capture.png')
    return
  }
  openPanel('screenshot', { image: payload.image })
}

function cancelShot(): void {
  if (!shotActive) return
  shotActive = false
  shot?.hide()
  if (globalShortcut.isRegistered(SHOT_ESCAPE)) globalShortcut.unregister(SHOT_ESCAPE)
  console.log('[shot] cancelled')
  if (shotFromPanel) {
    shotFromPanel = false
    revealPanel()
  }
}

/** Shows the panel after the renderer has committed the new content. The
 *  renderer acks with panel:ready; the timer is a fallback for a slow paint. */
function showPanelWindow(): void {
  if (panelShowTimer) {
    clearTimeout(panelShowTimer)
    panelShowTimer = null
  }
  if (!panelShowPending || !panel) return
  panelShowPending = false
  if (panel.isMinimized()) panel.restore()
  const started = PERF ? performance.now() : 0
  if (!panel.isVisible()) panel.showInactive()
  if (started) perf('panel reveal', Math.round(performance.now() - started))
  setImmediate(() => {
    if (!panel) return
    panel.focus()
  })
}

function schedulePanelShow(): void {
  if (!panel) return
  panelShowPending = true
  if (panelShowTimer) clearTimeout(panelShowTimer)
  panelShowTimer = setTimeout(showPanelWindow, 120)
}

/** Shows an already-reset panel immediately (insert failures, second instance). */
function revealPanel(): void {
  if (!panel) return
  if (panelShowTimer) {
    clearTimeout(panelShowTimer)
    panelShowTimer = null
  }
  panelShowPending = false
  if (panel.isMinimized()) panel.restore()
  if (!panel.isVisible()) panel.showInactive()
  setImmediate(() => {
    if (!panel) return
    panel.focus()
  })
}

function openPanel(
  action: Sector,
  extra: { image?: string; openHistory?: boolean } = {}
): void {
  if (!panel) return
  const started = PERF ? performance.now() : 0
  const wasMinimized = panel.isMinimized()
  // A minimized window reports isVisible() inconsistently on Windows. Treat
  // "restored from minimize" as a fresh reveal so the ack path shows and
  // focuses it even when restore() already made it visible.
  const wasVisible = panel.isVisible() && !wasMinimized
  if (wasMinimized) panel.restore()
  if (!panel.webContents.isLoading()) {
    panel.webContents.send('panel:open', {
      action,
      kind: KIND_BY_SECTOR[action],
      image: extra.image,
      openHistory: extra.openHistory
    })
  }
  if (wasVisible) {
    setImmediate(() => {
      if (!panel) return
      panel.focus()
    })
  } else {
    schedulePanelShow()
  }
  if (started) {
    perf(`panel:open sent ${Math.round(performance.now() - started)}ms`, {
      imageChars: extra.image?.length ?? 0
    })
  }
  captureIfRequested(panel, 'out/panel-capture.png')
  maybeRunTestMessage()
  maybeRunHistoryTest()
  maybeRunPanelShotTest()
  maybeStopTestRecording(action)
  maybeRunSettingsTest()
  maybeRunAsrDownloadTest()
  maybeRunHistoryOpenTest()
  maybeRunHistoryActionsTest()
  maybeRunKbOpenTest()
  maybeWriteDragTestTarget()
}

// Dev-only: clicks the knowledge-base button and captures the page.
function maybeRunKbOpenTest(): void {
  if (process.env.ROULETTE_TEST_KB_OPEN !== '1' || !panel) return
  const openCreate = process.env.ROULETTE_TEST_KB_CREATE === '1'
  setTimeout(() => {
    panel?.webContents
      .executeJavaScript(
        `(async () => {
          const button = document.querySelector('.kb-button');
          if (!(button instanceof HTMLButtonElement)) return 'no-button';
          button.click();
          ${
            openCreate
              ? `await new Promise((resolve) => setTimeout(resolve, 500));
                 const create = document.querySelector('.kb-secondary');
                 if (create instanceof HTMLButtonElement) create.click();`
              : ''
          }
          return 'clicked';
        })()`
      )
      .then((result) => console.log('[test] kb open', result))
      .catch((error) => console.warn('[test] kb open', error))
    setTimeout(() => {
      if (panel) captureIfRequested(panel, 'out/kb-capture.png')
    }, 1200)
  }, 1500)
}

// Dev-only: seeds a knowledge-base document so retrieval can be tested.
function maybeSeedKbTest(): void {
  if (process.env.ROULETTE_TEST_KB !== '1') return
  if (listKbDocuments().length > 0) {
    console.log('[test] kb already seeded')
    return
  }
  const text = `Roulette 使用说明
默认快捷键是按住 Alt 加鼠标右键呼出轮盘。
轮盘上有文字、截图、语音、历史四个扇区。
文字用于提问，截图用于识别屏幕区域，语音用于本地转写，历史用于恢复会话。
设置里可以填写 OpenAI 兼容接口和模型。`
  void ingestText('Roulette 使用说明', text, 'paste')
    .then((document) => console.log('[test] kb ingested', document?.id ?? 'null'))
    .catch((error) => console.warn('[test] kb ingest failed', error))
}

// Dev-only: opens the history drawer without resuming anything.
function maybeRunHistoryOpenTest(): void {
  if (process.env.ROULETTE_TEST_HISTORY_OPEN !== '1' || !panel) return
  setTimeout(() => {
    panel?.webContents
      .executeJavaScript(
        `(() => {
          const button = document.querySelector('.history-button');
          if (!(button instanceof HTMLButtonElement)) return 'no-button';
          button.click();
          return 'clicked';
        })()`
      )
      .then((result) => console.log('[test] history open', result))
      .catch((error) => console.warn('[test] history open', error))
    setTimeout(() => {
      if (panel) captureIfRequested(panel, 'out/history-capture.png')
    }, 700)
  }, 1500)
}

// Dev-only: exercises search, filtering, rename, delete, and undo in the drawer.
function maybeRunHistoryActionsTest(): void {
  if (process.env.ROULETTE_TEST_HISTORY_ACTIONS !== '1' || !panel) return
  setTimeout(() => {
    const script = `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const setValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const result = {};
      document.querySelector('.history-button')?.click();
      await wait(500);
      result.total = document.querySelectorAll('.history-item').length;

      const search = document.querySelector('.history-search input');
      if (search instanceof HTMLInputElement) {
        setValue(search, 'CAP');
        await wait(350);
        result.search = document.querySelectorAll('.history-item').length;
        setValue(search, '');
        await wait(350);
      }

      const chips = [...document.querySelectorAll('.filter-chip')];
      chips[2]?.click();
      await wait(350);
      result.shot = document.querySelectorAll('.history-item').length;
      chips[0]?.click();
      await wait(350);

      const firstRename = document.querySelector('.history-item .history-rename');
      firstRename?.click();
      await wait(250);
      const input = document.querySelector('.history-rename-input');
      if (input instanceof HTMLInputElement) {
        setValue(input, 'Renamed by test');
        await wait(150);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await wait(600);
      }
      result.renamed = document.querySelector('.history-item-title')?.textContent ?? null;

      result.beforeDelete = document.querySelectorAll('.history-item').length;
      document.querySelector('.history-item .history-delete')?.click();
      await wait(350);
      result.afterDelete = document.querySelectorAll('.history-item').length;
      document.querySelector('.undo-button')?.click();
      await wait(650);
      result.afterUndo = document.querySelectorAll('.history-item').length;
      return result;
    })()`
    panel?.webContents
      .executeJavaScript(script)
      .then((result) => console.log('[test] history actions', JSON.stringify(result)))
      .catch((error) => console.warn('[test] history actions', error))
  }, 1500)
}

// Dev-only: opens the settings panel so the voice section can be inspected.
function maybeRunSettingsTest(): void {
  if (process.env.ROULETTE_TEST_SETTINGS !== '1' || !panel) return
  setTimeout(() => {
    panel?.webContents
      .executeJavaScript(
        `(async () => {
          const button = document.querySelector('.settings-button');
          if (!(button instanceof HTMLButtonElement)) return 'no-button';
          button.click();
          await new Promise((resolve) => setTimeout(resolve, 250));
          const save = document.querySelector('.settings-page .save');
          return {
            clicked: true,
            saveDisabled: save instanceof HTMLButtonElement ? save.disabled : null
          };
        })()`
      )
      .then((result) => console.log('[test] settings', JSON.stringify(result)))
      .catch((error) => console.warn('[test] settings', error))
    if (process.env.ROULETTE_TEST_SETTINGS_EYE === '1') {
      setTimeout(() => {
        panel?.webContents
          .executeJavaScript(
            `(() => {
              const button = document.querySelector('.input-action');
              if (!(button instanceof HTMLButtonElement)) return 'no-eye';
              button.click();
              return 'revealed';
            })()`
          )
          .then((result) => console.log('[test] settings eye', result))
          .catch((error) => console.warn('[test] settings eye', error))
      }, 350)
    }
    if (process.env.ROULETTE_TEST_SETTINGS_SAVE === '1') {
      setTimeout(() => {
        panel?.webContents
          .executeJavaScript(
            `(async () => {
              const toggle = document.querySelector('.settings-page .switch');
              if (toggle instanceof HTMLButtonElement) toggle.click();
              await new Promise((resolve) => setTimeout(resolve, 200));
              const save = document.querySelector('.settings-page .save');
              if (save instanceof HTMLButtonElement) save.click();
              return 'saved';
            })()`
          )
          .then((result) => console.log('[test] settings save', result))
          .catch((error) => console.warn('[test] settings save', error))
      }, 500)
    }
    setTimeout(() => {
      if (panel) captureIfRequested(panel, 'out/settings-capture.png')
    }, 900)
  }, 2000)
}

// Dev-only: exercises the model downloader through the renderer IPC.
function maybeRunAsrDownloadTest(): void {
  if (process.env.ROULETTE_TEST_ASR_DOWNLOAD !== '1' || !panel) return
  setTimeout(() => {
    panel?.webContents
      .executeJavaScript(
        `window.roulette.downloadAsrModel().then((status) => ({
          installed: status.installed,
          downloading: status.downloading,
          error: status.error ?? null,
          received: status.receivedBytes,
          total: status.totalBytes
        }))`
      )
      .then((result) => console.log('[test] asr download', JSON.stringify(result)))
      .catch((error) => console.warn('[test] asr download', error))
  }, 1500)
}

function maybeStopTestRecording(action: Sector): void {
  if (action !== 'voice') return
  const ms = Number(process.env.ROULETTE_TEST_ASR_STOP_MS)
  if (!Number.isFinite(ms) || ms <= 0) return
  setTimeout(() => {
    sendToPanel('test:stop-recording')
  }, ms)
  setTimeout(() => {
    if (panel) captureIfRequested(panel, 'out/asr-capture.png')
  }, ms + 4500)
}

// Dev-only: writes the on-screen position of the newest completed answer so a
// script can drive a real mouse drag without guessing the panel layout.
function maybeWriteDragTestTarget(): void {
  const file = process.env.ROULETTE_TEST_DRAG_FILE
  if (!file || !panel) return
  const startedAt = Date.now()
  let written = false
  const timer = setInterval(() => {
    if (!panel || written || Date.now() - startedAt > 20000) {
      clearInterval(timer)
      return
    }
    panel.webContents
      .executeJavaScript(
        `(async () => {
          const find = () => {
            const cards = document.querySelectorAll('.answer');
            const answer = cards[cards.length - 1];
            return answer && answer.querySelector('.answer-actions') ? answer : null;
          };
          if (!find()) return null;
          // Wait for the conversation's smooth scroll to settle before
          // measuring; the action row appears before the last scroll frame.
          await new Promise((resolve) => setTimeout(resolve, 800));
          const answer = find();
          if (!answer) return null;
          const rect = answer.getBoundingClientRect();
          const handle = answer.querySelector('.drag-handle');
          const handleRect = handle instanceof HTMLElement ? handle.getBoundingClientRect() : rect;
          return {
            answer: { x: rect.left + rect.width / 2, y: rect.top + 48 },
            handle: {
              x: handleRect.left + handleRect.width / 2,
              y: handleRect.top + handleRect.height / 2
            },
            text: {
              x: rect.left + 45,
              y: rect.top + 22,
              toX: rect.left + rect.width - 30
            }
          };
        })()`
      )
      .then(
        (
          point: {
            answer: { x: number; y: number }
            handle: { x: number; y: number }
            text: { x: number; y: number; toX: number }
          } | null
        ) => {
          if (!point || !panel || written) return
          written = true
          clearInterval(timer)
          const bounds = panel.getBounds()
          const dip = { x: bounds.x, y: bounds.y }
          const target = {
            answer: toPhysical({
              x: dip.x + point.answer.x,
              y: dip.y + point.answer.y
            }),
            handle: toPhysical({
              x: dip.x + point.handle.x,
              y: dip.y + point.handle.y
            }),
            text: toPhysical({
              x: dip.x + point.text.x,
              y: dip.y + point.text.y
            }),
            textEnd: toPhysical({
              x: dip.x + point.text.toX,
              y: dip.y + point.text.y
            }),
            panel: toPhysical(dip)
          }
          fs.writeFileSync(path.join(app.getAppPath(), file), JSON.stringify(target))
          console.log('[test] drag target', JSON.stringify(target))
        }
      )
      .catch(() => {})
  }, 300)
}

// Dev-only: clicks the composer's camera button so the panel capture flow can
// be exercised without locating the window on screen.
function maybeRunPanelShotTest(): void {
  if (process.env.ROULETTE_TEST_PANEL_SHOT !== '1' || !panel) return
  setTimeout(() => {
    panel?.webContents
      .executeJavaScript(
        `(() => {
          const button = document.querySelector('.composer-tools .tool');
          if (!(button instanceof HTMLButtonElement)) return 'no-button';
          button.click();
          return 'clicked';
        })()`
      )
      .then((result) => console.log('[test] panel shot', result))
      .catch((error) => console.warn('[test] panel shot', error))
  }, 2000)
}

function onHookEvent(ev: HookEvent): void {
  switch (ev.type) {
    case 'ready':
      console.log('[hook] ready')
      break

    case 'down':
      targetHwnd = ev.hwnd
      console.log('[hook] down hwnd:', ev.hwnd)
      if (!active) showWheel('hold', toDip(ev.x, ev.y))
      break

    case 'foreground':
      targetHwnd = ev.hwnd
      break

    case 'trigger':
      if (shortcutCapture) break
      if (ev.action === 'click') toggleClickWheel()
      else if (ev.action === 'history') openHistoryPanel()
      break

    case 'drag-start':
      if (!textDrag) break
      console.log('[drag] tracked')
      showDragGhost(textDrag.text)
      sendToPanel('drag:state', true)
      break

    case 'drag-none':
      if (!textDrag) break
      console.log('[drag] not tracked (button already released)')
      cleanupTextDrag()
      break

    case 'drag-move':
      if (!textDrag) break
      positionDragGhost(toDip(ev.x, ev.y))
      break

    case 'drag-up': {
      if (!textDrag) break
      const text = textDrag.text
      const point = toDip(ev.x, ev.y)
      const droppedOnPanel = pointInWindow(panel, point) || pointInWindow(bubble, point)
      console.log('[drag] up at', ev.x, ev.y, 'onPanel:', droppedOnPanel)
      cleanupTextDrag()
      if (droppedOnPanel) break
      void dropTextAt(text, ev.x, ev.y)
      break
    }

    case 'move': {
      if (!active || mode !== 'hold') break
      const p = toDip(ev.x, ev.y)
      const dx = p.x - center.x
      const dy = p.y - center.y
      const distance = Math.hypot(dx, dy)
      const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
      const hovered: WheelResult =
        distance < DEAD_ZONE ? 'cancel' : sectorForAngle(angle)
      // The wheel only reacts to the hovered sector, so skip the IPC round trip
      // for the ~60 moves/s that stay inside one sector.
      if (hovered === lastWheelHovered) break
      lastWheelHovered = hovered
      sendToOverlay('wheel:move', { angle, distance })
      break
    }

    case 'up': {
      if (!active || mode !== 'hold') break
      const p = toDip(ev.x, ev.y)
      const dx = p.x - center.x
      const dy = p.y - center.y
      const distance = Math.hypot(dx, dy)
      const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
      console.log('[wheel] release', ev.x, ev.y, 'center', center.x, center.y, 'angle', Math.round(angle), 'dist', Math.round(distance))
      const result: Sector | 'cancel' =
        distance < DEAD_ZONE ? 'cancel' : sectorForAngle(angle)
      finishSelection(result)
      break
    }

    default:
      break
  }
}

function configurePermissions(): void {
  const isOurWindow = (contents: WebContents | null): boolean =>
    Boolean(contents) &&
    (contents === panel?.webContents ||
      contents === overlay?.webContents ||
      contents === shot?.webContents ||
      contents === bubble?.webContents ||
      contents === dragGhost?.webContents)

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === 'media' && isOurWindow(contents))
  })
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) => permission === 'media' && isOurWindow(contents)
  )
}

function bootstrap(): void {
  perf('bootstrap')
  if (!openStore(path.join(app.getPath('userData'), 'roulette.db'))) {
    console.warn('[store] history is disabled for this run')
  }
  perf('store open')

  overlay = createOverlayWindow()
  perf('overlay window created')
  panel = createPanelWindow()
  perf('panel window created')
  shot = createShotWindow()
  perf('shot window created')
  applyPanelPin(getPublicSettings().alwaysOnTop)
  panel.on('blur', minimizePanelIfUnpinned)
  keepWindowResident(panel, hidePanel)
  keepWindowResident(overlay, () => hideWheel())
  keepWindowResident(shot, () => cancelShot())
  createTray()

  configurePermissions()
  setKbProgressSink((status) => sendToPanel('kb:progress', status))
  maybeSeedKbTest()
  if (process.env.ROULETTE_TEST_OPEN_PANEL === '1') {
    setTimeout(() => {
      if (panel && !panel.isVisible()) openPanel('text')
    }, 1500)
  }

  console.log(
    '[display]',
    JSON.stringify(
      screen.getAllDisplays().map((display) => ({
        id: display.id,
        bounds: display.bounds,
        scale: display.scaleFactor
      }))
    )
  )
  perf('display enumerated')

  overlay.webContents.on('did-finish-load', () => {
    console.log('[overlay] ready')
    perf('overlay ready')
  })
  panel.webContents.on('did-finish-load', () => {
    console.log('[panel] ready')
    perf('panel ready')
  })
  // Escape while carrying text cancels the drag, not the whole panel. Handle
  // it before the renderer so the panel cannot close mid-drag.
  panel.webContents.on('before-input-event', (event, input) => {
    if (textDrag && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      cancelTextDrag()
    }
  })
  shot.webContents.on('did-finish-load', () => {
    console.log('[shot] ready')
    perf('shot ready')
    if (pendingShot) {
      shot?.webContents.send('shot:show', pendingShot)
      pendingShot = null
    }
  })
  // Catch Escape in the main process too: the renderer may not have keyboard
  // focus early in the overlay's life.
  shot.webContents.on('before-input-event', (_event, input) => {
    if (shotActive && input.type === 'keyDown' && input.key === 'Escape') {
      cancelShot()
    }
  })

  hook.on('event', onHookEvent)
  hook.on('exit', () => {
    console.warn('[hook] sidecar stopped; keyboard click mode still works')
    shortcutActive.hold = null
    shortcutErrors.hold = 'hook-unavailable'
    if (textDrag) cleanupTextDrag()
  })

  if (!hook.start(hookPath())) {
    console.warn('[hook] running without global mouse trigger')
  }
  perf('hook started')

  applyShortcuts(getPublicSettings().shortcuts)

  ipcMain.on('wheel:select', (_event, sector: Sector) => finishSelection(sector))
  ipcMain.on('wheel:cancel', () => finishSelection('cancel'))
  ipcMain.on('panel:close', hidePanel)
  ipcMain.on('panel:minimize', () => {
    cancelTextDrag()
    panel?.minimize()
  })
  ipcMain.handle('panel:pin', (_event, pinned: boolean) => {
    const updated = setAlwaysOnTopSetting(Boolean(pinned))
    applyPanelPin(updated.alwaysOnTop)
    return updated.alwaysOnTop
  })
  ipcMain.on('clipboard:write', (_event, text: string) => {
    void clipboard.writeText(String(text))
  })
  ipcMain.on('panel:insert', (_event, text: string) => {
    void insertText(String(text))
  })
  ipcMain.on('panel:drag-begin', (_event, text: string) => {
    beginTextDrag(String(text ?? ''))
  })
  ipcMain.on('panel:drag-prepare', () => warmDragGhost())
  ipcMain.on('panel:drag-cancel', () => {
    cancelTextDrag()
  })
  ipcMain.handle('drag:text', () => dragGhostPending ?? '')

  ipcMain.handle('settings:get', () => getPublicSettings())
  ipcMain.handle('shortcuts:get', () => getShortcutInfo())
  ipcMain.on('shortcuts:capture', (_event, capturing: boolean) => {
    shortcutCapture = Boolean(capturing)
    applyShortcuts(activeShortcuts)
  })
  ipcMain.handle('settings:key', () => getApiKey() ?? '')
  ipcMain.handle('settings:save', (_event, input: SettingsInput) => {
    const updated = saveSettings(input)
    applyShortcuts(updated.shortcuts)
    return updated
  })

  ipcMain.handle('history:list', () => listSessions())
  ipcMain.handle('history:get', (_event, id: string) => {
    const detail = getSession(String(id))
    if (!detail) return null
    return {
      ...detail,
      messages: detail.messages.map((message) => {
        let sources: KbSource[] | undefined
        if (message.meta) {
          try {
            const parsed = JSON.parse(message.meta) as { sources?: KbSource[] }
            if (Array.isArray(parsed.sources)) sources = parsed.sources
          } catch {
            // Ignore malformed metadata.
          }
        }
        return {
          ...message,
          image: message.imagePath
            ? (readImageDataUrl(message.imagePath) ?? undefined)
            : undefined,
          sources
        }
      })
    }
  })
  ipcMain.handle('history:delete', (_event, id: string) => {
    const imagePaths = deleteSession(String(id))
    for (const imagePath of imagePaths) {
      try {
        fs.unlinkSync(imagePath)
      } catch {
        // The file may already be gone; the row is what matters.
      }
    }
    return listSessions()
  })
  ipcMain.handle('history:rename', (_event, id: string, title: string) => {
    renameSession(String(id), String(title))
    return listSessions()
  })

  ipcMain.on('panel:ready', () => {
    perf('panel:ready')
    showPanelWindow()
  })
  ipcMain.on('shot:complete', (_event, payload: ShotCompletePayload) => finishShot(payload))
  ipcMain.on('shot:cancel', () => cancelShot())
  ipcMain.on('shot:hide', () => {
    if (!shotActive) return
    perf('shot early hide')
    shot?.hide()
  })
  ipcMain.on('panel:capture', () => {
    if (!shotActive) void startScreenshot(true)
  })

  ipcMain.handle('asr:status', () => getAsrStatus())
  ipcMain.handle('asr:download', async () => {
    try {
      await downloadModel((status) => sendToPanel('asr:progress', status))
    } catch (error) {
      console.warn('[asr] download failed', error)
    }
    return getAsrStatus()
  })
  ipcMain.handle('asr:transcribe', (_event, request: TranscribeRequest) => {
    const samples =
      request?.samples instanceof Float32Array
        ? request.samples
        : new Float32Array(Array.isArray(request?.samples) ? request.samples : [])
    const sampleRate = Number(request?.sampleRate) || 48000
    return transcribe(samples, sampleRate)
  })

  ipcMain.handle('kb:status', () => getKbStatus())
  ipcMain.handle('kb:prepare', () => prepareKb())
  ipcMain.handle('kb:documents', () => listKbDocuments())
  ipcMain.handle(
    'kb:add-text',
    async (_event, input: { title?: string; text?: string }) => {
      setKbIngestSink((progress) => sendToPanel('kb:ingest', progress))
      try {
        return await ingestText(String(input?.title ?? ''), String(input?.text ?? ''), 'paste')
      } finally {
        setKbIngestSink(null)
      }
    }
  )
  ipcMain.handle('kb:add-files', async () => {
    if (!panel) return []
    dialogOpen = true
    let result: Awaited<ReturnType<typeof dialog.showOpenDialog>>
    try {
      result = await dialog.showOpenDialog(panel, {
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Text', extensions: ['txt', 'md', 'markdown', 'csv', 'json', 'log'] }
        ]
      })
    } finally {
      dialogOpen = false
    }
    if (result.canceled || result.filePaths.length === 0) return []
    setKbIngestSink((progress) => sendToPanel('kb:ingest', progress))
    try {
      return await ingestFiles(result.filePaths)
    } finally {
      setKbIngestSink(null)
    }
  })
  ipcMain.handle('kb:delete', (_event, id: number) => {
    deleteKbDocument(Number(id))
    return listKbDocuments()
  })

  ipcMain.on('chat:start', (_event, request: ChatRequest) => {
    void handleChat(request)
  })
  ipcMain.on('chat:cancel', (_event, sessionId: string) => {
    activeChats.get(sessionId)?.abort()
  })
  ipcMain.on('bubble:toggle', togglePanelFromLauncher)
  ipcMain.on('bubble:move', (_event, point: { x?: number; y?: number }) => {
    if (!bubble) return
    const x = Number(point?.x)
    const y = Number(point?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const at = clampBubblePosition({ x, y })
    bubble.setPosition(at.x, at.y, false)
  })
  ipcMain.on('bubble:place', () => {
    if (!bubble) return
    const bounds = bubble.getBounds()
    setBubblePosition(bounds.x, bounds.y)
  })
  scheduleBubble()
  perf('bootstrap done')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    revealPanel()
  })

  app.whenReady().then(bootstrap)

  app.on('before-quit', () => {
    quitting = true
    for (const controller of activeChats.values()) controller.abort()
    activeChats.clear()
    hook.stop()
    globalShortcut.unregisterAll()
    tray?.destroy()
    tray = null
    closeStore()
  })

  app.on('window-all-closed', () => {
    // Resident app: windows hide instead of closing; quit from the tray menu.
  })
}
