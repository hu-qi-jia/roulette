import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpIcon,
  CameraIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  KindIcon,
  MicIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StopIcon,
  WheelMark
} from './icons'
import type {
  AppSettings,
  AsrStatus,
  ChatErrorCode,
  Sector,
  SessionKind,
  SessionSummary,
  SettingsInput
} from '../../shared/types'

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  image?: string
  errorCode?: ChatErrorCode
  streaming?: boolean
}

const WELCOME_ID = 0

const ACTION_LABEL: Record<Sector, string> = {
  text: 'text',
  screenshot: 'shot',
  voice: 'voiceLabel',
  history: 'history'
}

const KIND_BY_ACTION: Record<Sector, SessionKind> = {
  text: 'chat',
  screenshot: 'screenshot',
  voice: 'voice',
  history: 'chat'
}

const ACTION_BY_KIND: Record<SessionKind, Sector> = {
  chat: 'text',
  screenshot: 'screenshot',
  voice: 'voice'
}

const KIND_LABEL: Record<SessionKind, string> = {
  chat: 'text',
  screenshot: 'shot',
  voice: 'voiceLabel'
}

const ERROR_KEYS: Record<ChatErrorCode, string> = {
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

const ACTIONABLE_ERRORS: ReadonlySet<ChatErrorCode> = new Set([
  'no-key',
  'no-base-url',
  'no-model',
  'no-vision-model',
  'auth'
])

function newSessionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

interface SessionGroup {
  key: string
  labelKey: string
  items: SessionSummary[]
}

function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const groups: SessionGroup[] = [
    { key: 'today', labelKey: 'today', items: [] },
    { key: 'yesterday', labelKey: 'yesterday', items: [] },
    { key: 'earlier', labelKey: 'earlier', items: [] }
  ]

  for (const session of sessions) {
    if (session.updatedAt >= startOfToday) groups[0].items.push(session)
    else if (session.updatedAt >= startOfYesterday) groups[1].items.push(session)
    else groups[2].items.push(session)
  }

  return groups.filter((group) => group.items.length > 0)
}

async function decodeAudio(
  blob: Blob
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buffer = await blob.arrayBuffer()
  const context = new AudioContext()
  try {
    const audio = await context.decodeAudioData(buffer)
    return {
      samples: new Float32Array(audio.getChannelData(0)),
      sampleRate: audio.sampleRate
    }
  } finally {
    void context.close()
  }
}

export default function Panel(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [action, setAction] = useState<Sector>('text')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftBaseUrl, setDraftBaseUrl] = useState('')
  const [draftApiKey, setDraftApiKey] = useState('')
  const [draftModel, setDraftModel] = useState('')
  const [draftSeparateModels, setDraftSeparateModels] = useState(false)
  const [draftTextModel, setDraftTextModel] = useState('')
  const [draftVisionModel, setDraftVisionModel] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionTitle, setSessionTitle] = useState('')
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [asrStatus, setAsrStatus] = useState<AsrStatus | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [draftAsrAutoSend, setDraftAsrAutoSend] = useState(false)
  const [level, setLevel] = useState(0)
  const [noSound, setNoSound] = useState(false)
  const [autoSendPending, setAutoSendPending] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyKind, setHistoryKind] = useState<SessionKind | 'all'>('all')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [undoDelete, setUndoDelete] = useState<{ id: string; title: string } | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | null>(null)
  const sessionIdRef = useRef<string>(newSessionId())
  const streamingIdRef = useRef<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const asrAutoSendRef = useRef(false)
  const sendRef = useRef<(override?: string) => void>(() => {})
  const finishRecordingRef = useRef<() => Promise<void>>(async () => {})
  const audioMeterRef = useRef<{
    ctx: AudioContext
    analyser: AnalyserNode
    data: Uint8Array<ArrayBuffer>
  } | null>(null)
  const levelRafRef = useRef<number | null>(null)
  const autoSendTimerRef = useRef<number | null>(null)
  const pendingDeleteRef = useRef<{ id: string } | null>(null)
  const deleteTimerRef = useRef<number | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameCancelledRef = useRef(false)

  useEffect(() => {
    asrAutoSendRef.current = settings?.asrAutoSend === true
  }, [settings])

  const showToast = (text: string): void => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }

  const stopLevelMeter = (): void => {
    if (levelRafRef.current != null) {
      cancelAnimationFrame(levelRafRef.current)
      levelRafRef.current = null
    }
    const meter = audioMeterRef.current
    audioMeterRef.current = null
    if (meter) void meter.ctx.close().catch(() => {})
    setLevel(0)
    setNoSound(false)
  }

  const startLevelMeter = (stream: MediaStream): void => {
    stopLevelMeter()
    try {
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const data = new Uint8Array(new ArrayBuffer(analyser.fftSize))
      audioMeterRef.current = { ctx, analyser, data }
      void ctx.resume().catch(() => {})
      const started = Date.now()
      let peak = 0
      let lastUpdate = 0
      const tick = (): void => {
        const meter = audioMeterRef.current
        if (!meter) return
        meter.analyser.getByteTimeDomainData(meter.data)
        let sum = 0
        for (let i = 0; i < meter.data.length; i += 1) {
          const value = (meter.data[i] - 128) / 128
          sum += value * value
        }
        const rms = Math.sqrt(sum / meter.data.length)
        peak = Math.max(peak, rms)
        const now = performance.now()
        if (now - lastUpdate > 90) {
          lastUpdate = now
          setLevel(Math.min(1, rms * 5))
        }
        if (Date.now() - started > 2000 && peak < 0.008) setNoSound(true)
        levelRafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // Metering is optional; recording still works without it.
    }
  }

  const cancelAutoSend = (): void => {
    if (autoSendTimerRef.current != null) {
      window.clearTimeout(autoSendTimerRef.current)
      autoSendTimerRef.current = null
    }
    setAutoSendPending(false)
  }

  const scheduleAutoSend = (text: string): void => {
    cancelAutoSend()
    setAutoSendPending(true)
    autoSendTimerRef.current = window.setTimeout(() => {
      autoSendTimerRef.current = null
      setAutoSendPending(false)
      sendRef.current(text)
    }, 1500)
  }

  const populateSettingsDraft = (cfg: AppSettings): void => {
    const merged = cfg.textModel || cfg.visionModel
    const separate = Boolean(
      cfg.textModel && cfg.visionModel && cfg.textModel !== cfg.visionModel
    )
    setDraftBaseUrl(cfg.baseUrl)
    setDraftModel(merged)
    setDraftSeparateModels(separate)
    setDraftTextModel(cfg.textModel || merged)
    setDraftVisionModel(cfg.visionModel || merged)
    setDraftAsrAutoSend(cfg.asrAutoSend)
    setShowApiKey(false)
    setSettingsOpen(true)
    void window.roulette
      .getApiKey()
      .then((key) => setDraftApiKey(key))
      .catch(() => setDraftApiKey(''))
    void window.roulette
      .getAsrStatus()
      .then(setAsrStatus)
      .catch(() => {})
  }

  const openSettingsPanel = (): void => {
    const cfg = settings ?? {
      baseUrl: '',
      textModel: '',
      visionModel: '',
      hasApiKey: false,
      asrAutoSend: false
    }
    populateSettingsDraft(cfg)
  }

  const saveSettings = async (): Promise<void> => {
    const textModel = (draftSeparateModels ? draftTextModel : draftModel).trim()
    const visionModel = (draftSeparateModels ? draftVisionModel : draftModel).trim()
    const payload: SettingsInput = {
      baseUrl: draftBaseUrl,
      textModel,
      visionModel,
      apiKey: draftApiKey,
      asrAutoSend: draftAsrAutoSend
    }
    try {
      const updated = await window.roulette.saveSettings(payload)
      setSettings(updated)
      setSettingsOpen(false)
      setMessages((prev) =>
        prev.map((message) =>
          message.id === WELCOME_ID
            ? {
                ...message,
                text:
                  updated.hasApiKey && updated.baseUrl.trim() && updated.textModel.trim()
                    ? t('welcome')
                    : t('configureFirst')
              }
            : message
        )
      )
      showToast(t('saved'))
    } catch (error) {
      showToast(`${t('error')}${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const refreshHistory = async (): Promise<void> => {
    try {
      setSessions(await window.roulette.listSessions())
    } catch (error) {
      showToast(`${t('error')}${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const toggleHistory = (): void => {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next) void refreshHistory()
  }

  const resumeSession = async (summary: SessionSummary): Promise<void> => {
    try {
      const detail = await window.roulette.getSession(summary.id)
      if (!detail) {
        showToast(t('historyMissing'))
        await refreshHistory()
        return
      }
      window.roulette.cancelChat(sessionIdRef.current)
      abortRecording()
      sessionIdRef.current = detail.id
      streamingIdRef.current = null
      setBusy(false)
      setAction(ACTION_BY_KIND[detail.kind] ?? 'text')
      setSessionTitle(detail.title)
      setMessages(
        detail.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.content,
          image: message.image
        }))
      )
      setPendingImage(null)
      setHistoryOpen(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    } catch (error) {
      showToast(`${t('error')}${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const requestDelete = (session: SessionSummary): void => {
    // A second delete finalizes the previous one immediately.
    if (pendingDeleteRef.current) {
      const previous = pendingDeleteRef.current.id
      if (deleteTimerRef.current != null) {
        window.clearTimeout(deleteTimerRef.current)
        deleteTimerRef.current = null
      }
      void window.roulette.deleteSession(previous).catch(() => {})
    }

    if (session.id === sessionIdRef.current) {
      window.roulette.cancelChat(session.id)
      abortRecording()
      sessionIdRef.current = newSessionId()
      streamingIdRef.current = null
      setBusy(false)
      setSessionTitle('')
      setInput('')
      setPendingImage(null)
      setMessages([{ id: WELCOME_ID, role: 'assistant', text: t('welcome') }])
    }

    setSessions((prev) => prev.filter((item) => item.id !== session.id))
    pendingDeleteRef.current = { id: session.id }
    setUndoDelete({ id: session.id, title: session.title })
    deleteTimerRef.current = window.setTimeout(() => {
      pendingDeleteRef.current = null
      setUndoDelete(null)
      deleteTimerRef.current = null
      void window.roulette.deleteSession(session.id).catch((error) => {
        showToast(`${t('error')}${error instanceof Error ? error.message : String(error)}`)
        void refreshHistory()
      })
    }, 5000)
  }

  const undoDeleteAction = (): void => {
    if (!pendingDeleteRef.current) return
    pendingDeleteRef.current = null
    setUndoDelete(null)
    if (deleteTimerRef.current != null) {
      window.clearTimeout(deleteTimerRef.current)
      deleteTimerRef.current = null
    }
    void refreshHistory()
  }

  const beginRename = (session: SessionSummary): void => {
    renameCancelledRef.current = false
    setRenamingId(session.id)
    setRenameDraft(session.title)
    requestAnimationFrame(() => renameInputRef.current?.focus())
  }

  const commitRename = async (id: string): Promise<void> => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      return
    }
    const title = renameDraft.trim()
    setRenamingId(null)
    if (!title) return
    try {
      setSessions(await window.roulette.renameSession(id, title))
      if (id === sessionIdRef.current) setSessionTitle(title)
    } catch (error) {
      showToast(`${t('error')}${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const formatTime = (timestamp: number): string => {
    try {
      return new Intl.DateTimeFormat(i18n.language === 'zh' ? 'zh-CN' : 'en', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(timestamp)
    } catch {
      return new Date(timestamp).toLocaleString()
    }
  }

  const startNewSession = (): void => {
    window.roulette.cancelChat(sessionIdRef.current)
    abortRecording()
    sessionIdRef.current = newSessionId()
    streamingIdRef.current = null
    setBusy(false)
    setAction('text')
    setSessionTitle('')
    setInput('')
    setPendingImage(null)
    setMessages([{ id: WELCOME_ID, role: 'assistant', text: t('welcome') }])
    setHistoryOpen(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const abortRecording = (): void => {
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {
        // Already stopped.
      }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    chunksRef.current = []
    stopLevelMeter()
    cancelAutoSend()
    setRecording(false)
  }

  const stopRecording = (): void => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    recorder.stop()
  }

  const beginRecording = async (): Promise<void> => {
    if (recorderRef.current || transcribing) return

    try {
      const status = await window.roulette.getAsrStatus()
      setAsrStatus(status)
      if (!status.installed) {
        showToast(t('asrNotInstalled'))
        openSettingsPanel()
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })

      streamRef.current = stream
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        void finishRecordingRef.current()
      }
      recorder.start(250)
      recorderRef.current = recorder
      setRecordSeconds(0)
      setRecording(true)
      startLevelMeter(stream)
    } catch (error) {
      showToast(
        `${t('micDenied')} ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const finishRecording = async (): Promise<void> => {
    setRecording(false)
    stopLevelMeter()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    const chunks = chunksRef.current
    chunksRef.current = []
    if (chunks.length === 0) return

    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' })
    if (blob.size === 0) return

    setTranscribing(true)
    try {
      const audio = await decodeAudio(blob)
      const result = await window.roulette.transcribe(audio)
      const text = result.text.trim()
      if (!text) {
        showToast(t('emptyTranscript'))
        return
      }
      setInput(text)
      requestAnimationFrame(() => inputRef.current?.focus())
      if (asrAutoSendRef.current) scheduleAutoSend(text)
    } catch (error) {
      showToast(
        `${t('asrFailed')}${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setTranscribing(false)
    }
  }
  finishRecordingRef.current = finishRecording

  const downloadAsr = async (): Promise<void> => {
    try {
      setAsrStatus(await window.roulette.downloadAsrModel())
    } catch (error) {
      showToast(`${t('error')}${error instanceof Error ? error.message : String(error)}`)
    }
  }

  useEffect(() => {
    if (!recording) return
    const started = Date.now()
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000)
      setRecordSeconds(seconds)
      if (seconds >= 60) stopRecording()
    }, 500)
    return () => window.clearInterval(timer)
  }, [recording])

  useEffect(() => {
    void window.roulette
      .getAsrStatus()
      .then(setAsrStatus)
      .catch(() => {})
    return window.roulette.onAsrProgress((status) => setAsrStatus(status))
  }, [])

  useEffect(() => {
    return window.roulette.onTestStopRecording(() => stopRecording())
  }, [])

  useEffect(() => {
    const off = window.roulette.onPanelOpen((payload) => {
      abortRecording()
      cancelAutoSend()
      window.roulette.cancelChat(sessionIdRef.current)
      sessionIdRef.current = newSessionId()
      streamingIdRef.current = null
      setBusy(false)
      setAction(payload.action)
      setSessionTitle('')
      setInput('')
      setPendingImage(payload.image ?? null)
      setHistoryOpen(payload.openHistory === true)
      if (payload.openHistory) void refreshHistory()

      void window.roulette
        .getSettings()
        .then((cfg) => {
          setSettings(cfg)
          asrAutoSendRef.current = cfg.asrAutoSend
          const ready = Boolean(cfg.hasApiKey && cfg.baseUrl.trim() && cfg.textModel.trim())
          setMessages([
            {
              id: WELCOME_ID,
              role: 'assistant',
              text: ready ? t('welcome') : t('configureFirst')
            }
          ])
          if (!ready) {
            populateSettingsDraft(cfg)
          } else if (payload.action === 'voice') {
            void beginRecording()
          }
        })
        .catch((error) => {
          setMessages([
            { id: WELCOME_ID, role: 'assistant', text: `${t('error')}${String(error)}` }
          ])
        })

      requestAnimationFrame(() => inputRef.current?.focus())
    })
    return off
  }, [t])

  useEffect(() => {
    const finish = (id: number | null): void => {
      streamingIdRef.current = null
      setBusy(false)
      if (id == null) return
      setMessages((prev) =>
        prev.map((message) =>
          message.id === id
            ? { ...message, streaming: false, text: message.text || t('emptyReply') }
            : message
        )
      )
    }

    const offDelta = window.roulette.onChatDelta(({ sessionId, delta }) => {
      if (sessionId !== sessionIdRef.current) return
      const id = streamingIdRef.current
      if (id == null) return
      setMessages((prev) =>
        prev.map((message) =>
          message.id === id ? { ...message, text: message.text + delta } : message
        )
      )
    })

    const offDone = window.roulette.onChatDone(({ sessionId }) => {
      if (sessionId !== sessionIdRef.current) return
      finish(streamingIdRef.current)
    })

    const offError = window.roulette.onChatError(({ sessionId, message, code }) => {
      if (sessionId !== sessionIdRef.current) return
      const id = streamingIdRef.current
      streamingIdRef.current = null
      setBusy(false)
      const resolved = code ?? 'unknown'
      const base = t(ERROR_KEYS[resolved])
      const friendly =
        resolved === 'http' || resolved === 'unknown'
          ? `${base}${message ? ` ${message}` : ''}`
          : base
      showToast(friendly)
      if (id != null) {
        setMessages((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  streaming: false,
                  text: item.text || friendly,
                  errorCode: resolved
                }
              : item
          )
        )
      }
    })

    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [t])

  useEffect(() => {
    return window.roulette.onInsertFailed(() => {
      showToast(t('insertFailed'))
    })
  }, [t])

  useEffect(() => {
    return window.roulette.onPanelAttach(({ image }) => {
      setPendingImage(image)
      requestAnimationFrame(() => inputRef.current?.focus())
    })
  }, [])

  useEffect(() => {
    return window.roulette.onOpenHistory(() => {
      setHistoryOpen(true)
      void refreshHistory()
      requestAnimationFrame(() => inputRef.current?.focus())
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (settingsOpen) {
        setSettingsOpen(false)
        return
      }
      if (historyOpen) {
        setHistoryOpen(false)
        return
      }
      if (busy) {
        window.roulette.cancelChat(sessionIdRef.current)
        return
      }
      abortRecording()
      window.roulette.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, historyOpen, busy])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    return () => {
      stopLevelMeter()
      cancelAutoSend()
      if (deleteTimerRef.current != null) window.clearTimeout(deleteTimerRef.current)
    }
  }, [])

  const insertLast = (): void => {
    const last = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && !message.streaming && message.text.trim())
    if (!last) return
    window.roulette.insertText(last.text)
  }

  const stop = (): void => {
    window.roulette.cancelChat(sessionIdRef.current)
  }

  const send = (override?: string): void => {
    cancelAutoSend()
    if (busy) {
      stop()
      return
    }

    const trimmed = (override ?? input).trim()
    if (!trimmed && !pendingImage) {
      insertLast()
      return
    }

    const text = trimmed || t('defaultShotPrompt')
    const image = pendingImage ?? undefined
    const now = Date.now()
    const user: Message = { id: now, role: 'user', text, image }
    const assistantId = now + 1
    const flat = text.replace(/\s+/g, ' ')

    setMessages((prev) => [
      ...prev,
      user,
      { id: assistantId, role: 'assistant', text: '', streaming: true }
    ])
    setInput('')
    setPendingImage(null)
    setBusy(true)
    setSessionTitle((current) => current || (flat.length > 40 ? `${flat.slice(0, 40)}…` : flat))
    streamingIdRef.current = assistantId
    window.roulette.chat({
      sessionId: sessionIdRef.current,
      kind: KIND_BY_ACTION[action],
      text,
      image
    })
  }
  sendRef.current = send

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (busy) {
      stop()
      return
    }
    if (event.ctrlKey || event.metaKey) insertLast()
    else send()
  }

  const asrPercent =
    asrStatus && asrStatus.totalBytes > 0
      ? Math.min(100, Math.round((asrStatus.receivedBytes / asrStatus.totalBytes) * 100))
      : 0

  const hasConversation = messages.some((message) => message.id !== WELCOME_ID)
  const welcomeText =
    messages.find((message) => message.id === WELCOME_ID)?.text ?? t('welcome')

  const filteredSessions = sessions.filter((session) => {
    if (historyKind !== 'all' && session.kind !== historyKind) return false
    const query = historyQuery.trim().toLowerCase()
    if (!query) return true
    return (
      session.title.toLowerCase().includes(query) ||
      session.preview.toLowerCase().includes(query)
    )
  })
  const historyGroups = groupSessions(filteredSessions)
  const isFreshSession =
    !hasConversation && !input.trim() && !pendingImage && !recording && !transcribing
  const canSave = Boolean(
    draftBaseUrl.trim() &&
      (draftSeparateModels
        ? draftTextModel.trim() && draftVisionModel.trim()
        : draftModel.trim())
  )

  return (
    <div className="panel-shell">
      <header className="panel-header">
        <div className="header-side">
          <button
            className="icon-button history-button"
            title={t('history')}
            onClick={toggleHistory}
          >
            <HistoryIcon />
          </button>
        </div>
        <div className="brand">
          <span className="brand-mark">
            <WheelMark />
          </span>
          <span className="brand-name">{t('appName')}</span>
          {action !== 'text' && (
            <span className="action-chip">{t(ACTION_LABEL[action])}</span>
          )}
          {sessionTitle && (
            <span className="session-title" title={sessionTitle}>
              {sessionTitle}
            </span>
          )}
        </div>
        <div className="header-side right">
          <button
            className="icon-button settings-button"
            title={t('settings')}
            onClick={openSettingsPanel}
          >
            <SettingsIcon />
          </button>
          <button
            className="icon-button close"
            title={t('close')}
            onClick={() => {
              abortRecording()
              window.roulette.closePanel()
            }}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <main className={hasConversation ? 'messages' : 'messages empty'} ref={listRef}>
        {hasConversation ? (
          messages
            .filter((message) => message.id !== WELCOME_ID)
            .map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                <div className="bubble">
                  {message.image && (
                    <img className="bubble-image" src={message.image} alt="" />
                  )}
                  {message.streaming && !message.text ? (
                    <span className="typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    message.text
                  )}
                </div>
                {message.role === 'assistant' &&
                  !message.streaming &&
                  message.text.trim() &&
                  !message.errorCode && (
                    <button
                      className="insert-button"
                      onClick={() => window.roulette.insertText(message.text)}
                    >
                      {t('insert')}
                    </button>
                  )}
                {message.errorCode && ACTIONABLE_ERRORS.has(message.errorCode) && (
                  <button className="insert-button" onClick={openSettingsPanel}>
                    {t('openSettings')}
                  </button>
                )}
              </div>
            ))
        ) : (
          <div className="empty-state">
            <div className="empty-mark">
              <WheelMark size={34} />
            </div>
            <h1>{t('appName')}</h1>
            <p>{welcomeText}</p>
            <span className="empty-hint">{t('shortcutHint')}</span>
          </div>
        )}
      </main>

      <footer className="composer">
        <div className="composer-card">
          {recording && (
            <div className="recording-bar">
              <span className="recording-dot" />
              <span>
                {t('recording')} {formatDuration(recordSeconds)} / {formatDuration(60)}
              </span>
              <span className="level-meter" aria-hidden="true">
                <span
                  className="level-fill"
                  style={{ width: `${Math.round(level * 100)}%` }}
                />
              </span>
              {noSound && <span className="no-sound">{t('noSound')}</span>}
              <button className="ghost small" onClick={stopRecording}>
                {t('stopRecording')}
              </button>
            </div>
          )}
          {autoSendPending && (
            <div className="auto-send-bar">
              <span className="spinner" />
              <span>{t('autoSending')}</span>
              <button className="ghost small" onClick={cancelAutoSend}>
                {t('cancel')}
              </button>
            </div>
          )}
          {transcribing && (
            <div className="recording-bar">
              <span className="spinner" />
              <span>{t('transcribing')}</span>
            </div>
          )}
          {pendingImage && (
            <div className="attachment">
              <img src={pendingImage} alt="" />
              <span>{t('imageAttached')}</span>
              <button
                className="attachment-remove"
                title={t('remove')}
                onClick={() => setPendingImage(null)}
              >
                <CloseIcon />
              </button>
            </div>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder={t('placeholder')}
            onChange={(event) => {
              if (autoSendPending) cancelAutoSend()
              setInput(event.target.value)
            }}
            onKeyDown={onKeyDown}
          />
          <div className="composer-actions">
            <div className="composer-tools">
              <button
                className="tool"
                title={t('shot')}
                onClick={() => window.roulette.captureScreenshot()}
              >
                <CameraIcon />
              </button>
              <button
                className={`tool ${recording ? 'recording' : ''}`}
                title={recording ? t('stopRecording') : t('voiceLabel')}
                onClick={() => (recording ? stopRecording() : void beginRecording())}
                disabled={transcribing}
              >
                <MicIcon />
              </button>
            </div>
            <button
              className={busy ? 'send-circle stop' : 'send-circle'}
              title={busy ? t('stop') : t('send')}
              onClick={() => send()}
              disabled={!busy && !input.trim() && !pendingImage}
            >
              {busy ? <StopIcon /> : <ArrowUpIcon />}
            </button>
          </div>
        </div>
      </footer>

      {historyOpen && (
        <>
          <div className="history-backdrop" onClick={() => setHistoryOpen(false)} />
          <aside className="history-drawer">
            <button
              className="history-new"
              onClick={startNewSession}
              disabled={isFreshSession}
            >
              <span className="history-new-icon">
                <PlusIcon />
              </span>
              {t('newSession')}
            </button>

            <div className="history-search">
              <SearchIcon size={15} />
              <input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder={t('searchHistory')}
              />
              {historyQuery && (
                <button
                  className="history-search-clear"
                  title={t('clearSearch')}
                  onClick={() => setHistoryQuery('')}
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </div>

            <div className="history-filters">
              {(['all', 'chat', 'screenshot', 'voice'] as const).map((kind) => (
                <button
                  key={kind}
                  className={`filter-chip ${historyKind === kind ? 'active' : ''}`}
                  onClick={() => setHistoryKind(kind)}
                >
                  {kind === 'all' ? t('all') : t(KIND_LABEL[kind])}
                </button>
              ))}
            </div>

            {sessions.length === 0 ? (
              <div className="history-empty">{t('emptyHistory')}</div>
            ) : filteredSessions.length === 0 ? (
              <div className="history-empty">{t('noResults')}</div>
            ) : (
              <div className="history-list">
                {historyGroups.map((group) => (
                  <div key={group.key} className="history-group">
                    <div className="history-group-label">{t(group.labelKey)}</div>
                    {group.items.map((session) => (
                      <div
                        key={session.id}
                        className={
                          session.id === sessionIdRef.current
                            ? 'history-item current'
                            : 'history-item'
                        }
                        onClick={() => {
                          if (renamingId === session.id) return
                          void resumeSession(session)
                        }}
                      >
                        <span className={`history-kind kind-${session.kind}`}>
                          <KindIcon kind={session.kind} />
                        </span>
                        <div className="history-item-main">
                          {renamingId === session.id ? (
                            <input
                              ref={renameInputRef}
                              className="history-rename-input"
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                              onBlur={() => void commitRename(session.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void commitRename(session.id)
                                } else if (event.key === 'Escape') {
                                  event.stopPropagation()
                                  renameCancelledRef.current = true
                                  setRenamingId(null)
                                }
                              }}
                            />
                          ) : (
                            <div className="history-item-title">
                              {session.title || t('untitled')}
                            </div>
                          )}
                          <div className="history-item-meta">
                            {t(KIND_LABEL[session.kind])} · {formatTime(session.updatedAt)}
                          </div>
                          {session.preview && (
                            <div className="history-item-preview">{session.preview}</div>
                          )}
                        </div>
                        <button
                          className="history-rename"
                          title={t('rename')}
                          onClick={(event) => {
                            event.stopPropagation()
                            beginRename(session)
                          }}
                        >
                          <PencilIcon />
                        </button>
                        <button
                          className="history-delete"
                          title={t('delete')}
                          onClick={(event) => {
                            event.stopPropagation()
                            requestDelete(session)
                          }}
                        >
                          <CloseIcon size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </>
      )}

      {settingsOpen && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false)
          }}
        >
          <div className="settings-modal">
            <h2>{t('settings')}</h2>
            {!settings?.hasApiKey && (
              <p className="onboarding-hint">{t('onboardingHint')}</p>
            )}

            <div className="settings-section">
              <div className="settings-section-title">{t('connection')}</div>
              <label>
                <span>{t('baseUrl')}</span>
                <input
                  value={draftBaseUrl}
                  onChange={(event) => setDraftBaseUrl(event.target.value)}
                  placeholder="https://api.openai.com/v1"
                  autoFocus
                />
              </label>
              <label>
                <span>{t('apiKey')}</span>
                <div className="input-with-action">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={draftApiKey}
                    onChange={(event) => setDraftApiKey(event.target.value)}
                    placeholder="sk-..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="input-action"
                    title={showApiKey ? t('hideKey') : t('showKey')}
                    onClick={() => setShowApiKey((visible) => !visible)}
                  >
                    {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </label>
            </div>

            <div className="settings-divider" />

            <div className="settings-section">
              <div className="settings-section-title">{t('model')}</div>
              {draftSeparateModels ? (
                <>
                  <label>
                    <span>{t('textModel')}</span>
                    <input
                      value={draftTextModel}
                      onChange={(event) => setDraftTextModel(event.target.value)}
                      placeholder="gpt-4o-mini / deepseek-chat"
                    />
                  </label>
                  <label>
                    <span>{t('visionModel')}</span>
                    <input
                      value={draftVisionModel}
                      onChange={(event) => setDraftVisionModel(event.target.value)}
                      placeholder="gpt-4o-mini / qwen-vl-plus"
                    />
                  </label>
                </>
              ) : (
                <label>
                  <input
                    value={draftModel}
                    onChange={(event) => setDraftModel(event.target.value)}
                    placeholder="gpt-4o-mini / qwen-vl-plus"
                  />
                </label>
              )}
              <span className="field-hint">{t('multimodalHint')}</span>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  if (draftSeparateModels) {
                    setDraftModel(draftTextModel || draftVisionModel)
                    setDraftSeparateModels(false)
                  } else {
                    setDraftTextModel(draftModel)
                    setDraftVisionModel(draftModel)
                    setDraftSeparateModels(true)
                  }
                }}
              >
                {draftSeparateModels ? t('useSingleModel') : t('separateModels')}
              </button>
            </div>

            <div className="settings-divider" />

            <div className="settings-section">
              <div className="settings-section-title">{t('voiceInput')}</div>
              <div className="asr-row">
                <span className={asrStatus?.installed ? 'asr-ok' : 'asr-missing'}>
                  {asrStatus?.downloading
                    ? `${t('asrDownloading')} ${asrPercent}%`
                    : asrStatus?.installed
                      ? t('asrReady')
                      : t('asrMissing')}
                </span>
                {!asrStatus?.installed && !asrStatus?.downloading && (
                  <button className="ghost small" onClick={() => void downloadAsr()}>
                    {t('downloadModel')}
                  </button>
                )}
              </div>
              {asrStatus?.downloading && (
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${asrPercent}%` }} />
                </div>
              )}
              {asrStatus?.error && <div className="asr-error">{asrStatus.error}</div>}
              {asrStatus?.modelDir && (
                <div className="asr-path" title={asrStatus.modelDir}>
                  {asrStatus.modelDir}
                </div>
              )}
              <div className="switch-row">
                <span>{t('autoSend')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draftAsrAutoSend}
                  className={`switch ${draftAsrAutoSend ? 'on' : ''}`}
                  onClick={() => setDraftAsrAutoSend((enabled) => !enabled)}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button className="ghost" onClick={() => setSettingsOpen(false)}>
                {t('cancel')}
              </button>
              <button
                className="primary"
                disabled={!canSave}
                onClick={() => void saveSettings()}
              >
                {t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
      {undoDelete && (
        <div className="toast undo-toast">
          <span>{t('sessionDeleted')}</span>
          <button className="undo-button" onClick={undoDeleteAction}>
            {t('undo')}
          </button>
        </div>
      )}
    </div>
  )
}
