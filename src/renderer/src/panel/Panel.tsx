import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import { cloneShortcuts, DEFAULT_SHORTCUTS } from '../../../shared/shortcuts'
import type {
  AppSettings,
  AsrStatus,
  KbSource,
  Sector,
  SessionSummary,
  ShortcutInfo
} from '../../../shared/types'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'
import { HistoryView } from './components/HistoryView'
import { KnowledgeBaseView } from './components/KnowledgeBaseView'
import { PanelHeader } from './components/PanelHeader'
import { SettingsView } from './components/SettingsView'
import {
  ACTION_BY_KIND,
  ERROR_KEYS,
  KIND_BY_ACTION,
  WELCOME_ID
} from './constants'
import { useHistory } from './hooks/useHistory'
import { useKnowledgeBase } from './hooks/useKnowledgeBase'
import { useRecorder } from './hooks/useRecorder'
import { useSettingsDraft } from './hooks/useSettingsDraft'
import type { Message, PanelView } from './types'

function newSessionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
}

function isConfigured(settings: AppSettings | null): boolean {
  return Boolean(
    settings?.hasApiKey &&
      settings.baseUrl.trim() &&
      settings.textModel.trim()
  )
}

export default function Panel(): React.JSX.Element {
  const { t } = useTranslation()

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | null>(null)
  const sessionIdRef = useRef<string>(newSessionId())
  const streamingIdRef = useRef<number | null>(null)
  const autoSendTimerRef = useRef<number | null>(null)
  const autoSendRef = useRef(false)
  const nearBottomRef = useRef(true)
  const forceScrollRef = useRef(false)
  const lastViewRef = useRef<PanelView>('chat')
  const sendRef = useRef<(override?: string) => void>(() => {})
  const scheduleAutoSendRef = useRef<(text: string) => void>(() => {})
  const openSettingsRef = useRef<() => void>(() => {})

  const [view, setView] = useState<PanelView>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [action, setAction] = useState<Sector>('text')
  const [toast, setToast] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [sessionTitle, setSessionTitle] = useState('')
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [asrStatus, setAsrStatus] = useState<AsrStatus | null>(null)
  const [shortcuts, setShortcuts] = useState<ShortcutInfo | null>(null)
  const [autoSendPending, setAutoSendPending] = useState(false)
  const [settingsFocus, setSettingsFocus] = useState<'vector' | null>(null)

  const showToast = useCallback((text: string): void => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  const cancelAutoSend = useCallback((): void => {
    if (autoSendTimerRef.current != null) {
      window.clearTimeout(autoSendTimerRef.current)
      autoSendTimerRef.current = null
    }
    setAutoSendPending(false)
  }, [])

  const scheduleAutoSend = useCallback(
    (text: string): void => {
      cancelAutoSend()
      setAutoSendPending(true)
      autoSendTimerRef.current = window.setTimeout(() => {
        autoSendTimerRef.current = null
        setAutoSendPending(false)
        sendRef.current(text)
      }, 1500)
    },
    [cancelAutoSend]
  )
  scheduleAutoSendRef.current = scheduleAutoSend

  const handleTranscribed = useCallback((text: string): void => {
    setInput(text)
    requestAnimationFrame(() => inputRef.current?.focus())
    if (autoSendRef.current) scheduleAutoSendRef.current(text)
  }, [])

  const recorder = useRecorder({
    onTranscribed: handleTranscribed,
    onToast: showToast,
    onOpenSettings: () => openSettingsRef.current()
  })
  const {
    recording,
    recordSeconds,
    transcribing,
    level,
    noSound,
    beginRecording,
    stopRecording,
    abortRecording
  } = recorder

  const resetConversation = useCallback((): void => {
    window.roulette.cancelChat(sessionIdRef.current)
    abortRecording()
    cancelAutoSend()
    sessionIdRef.current = newSessionId()
    streamingIdRef.current = null
    setBusy(false)
    setAction('text')
    setSessionTitle('')
    setInput('')
    setPendingImage(null)
    setMessages([
      {
        id: WELCOME_ID,
        role: 'assistant',
        text: isConfigured(settings) ? t('welcome') : t('configureFirst')
      }
    ])
  }, [abortRecording, cancelAutoSend, settings, t])

  const handleDeleteCurrent = useCallback((): void => {
    resetConversation()
  }, [resetConversation])

  const handleRenamed = useCallback((id: string, title: string): void => {
    if (id === sessionIdRef.current) setSessionTitle(title)
  }, [])

  const handleSettingsSaved = useCallback(
    (updated: AppSettings): void => {
      setSettings(updated)
      autoSendRef.current = updated.asrAutoSend
      void window.roulette
        .getShortcuts()
        .then((info) => setShortcuts(info))
        .catch(() => setShortcuts(null))
      const ready = isConfigured(updated)
      setMessages((current) =>
        current.map((message) =>
          message.id === WELCOME_ID
            ? {
                ...message,
                text: ready ? t('welcome') : t('configureFirst')
              }
            : message
        )
      )
    },
    [t]
  )

  const history = useHistory({
    isCurrent: (id) => id === sessionIdRef.current,
    onDeleteCurrent: handleDeleteCurrent,
    onRenamed: handleRenamed,
    onToast: showToast
  })

  const settingsDraft = useSettingsDraft({
    onSaved: handleSettingsSaved,
    onToast: showToast
  })

  const kb = useKnowledgeBase({ onToast: showToast })

  useEffect(() => {
    autoSendRef.current = settings?.asrAutoSend === true
  }, [settings])

  useEffect(() => {
    void window.roulette
      .getAsrStatus()
      .then((status) => setAsrStatus(status))
      .catch(() => {})
    return window.roulette.onAsrProgress((status) => setAsrStatus(status))
  }, [])

  // Load settings independently of the first panel-open event so the settings
  // page and the empty state are correct even if that event is missed while
  // the renderer is still booting.
  useEffect(() => {
    void window.roulette
      .getSettings()
      .then((config) => {
        setSettings(config)
        autoSendRef.current = config.asrAutoSend
        const ready = isConfigured(config)
        setMessages((current) =>
          current.length === 0
            ? [
                {
                  id: WELCOME_ID,
                  role: 'assistant',
                  text: ready ? t('welcome') : t('configureFirst')
                }
              ]
            : current
        )
      })
      .catch(() => {})
  }, [t])

  useEffect(() => {
    const finish = (id: number | null): void => {
      streamingIdRef.current = null
      setBusy(false)
      if (id == null) return
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? {
                ...message,
                streaming: false,
                text: message.text || t('emptyReply')
              }
            : message
        )
      )
    }

    const offDelta = window.roulette.onChatDelta(({ sessionId, delta }) => {
      if (sessionId !== sessionIdRef.current) return
      const id = streamingIdRef.current
      if (id == null) return
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? { ...message, text: message.text + delta }
            : message
        )
      )
    })

    const offDone = window.roulette.onChatDone(({ sessionId, sources }) => {
      if (sessionId !== sessionIdRef.current) return
      const id = streamingIdRef.current
      if (id != null && sources && sources.length > 0) {
        setMessages((current) =>
          current.map((message) =>
            message.id === id ? { ...message, sources } : message
          )
        )
      }
      finish(id)
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
        setMessages((current) =>
          current.map((item) =>
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
  }, [showToast, t])

  useEffect(() => {
    return window.roulette.onInsertFailed(() => {
      showToast(t('insertFailed'))
    })
  }, [showToast, t])

  useEffect(() => {
    return window.roulette.onPanelAttach(({ image }) => {
      setPendingImage(image)
      const preview = new Image()
      preview.src = image
      void preview
        .decode()
        .catch(() => {})
        .finally(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.roulette.panelReady()
              inputRef.current?.focus()
            })
          })
        })
    })
  }, [])

  useEffect(() => {
    return window.roulette.onOpenHistory(() => {
      setView('history')
      void history.refresh()
      requestAnimationFrame(() => inputRef.current?.focus())
    })
  }, [history.refresh])

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
      setView(payload.openHistory ? 'history' : 'chat')
      if (payload.openHistory) void history.refresh()
      // Replace the previous conversation before the window is mapped so the
      // first visible frame is the new session, not the old messages.
      const configuredNow = isConfigured(settings)
      setMessages([
        {
          id: WELCOME_ID,
          role: 'assistant',
          text: configuredNow ? t('welcome') : t('configureFirst')
        }
      ])
      const notifyReady = (): void => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => window.roulette.panelReady())
        })
      }
      if (payload.image) {
        const preview = new Image()
        preview.src = payload.image
        void preview.decode().catch(() => {}).finally(notifyReady)
      } else {
        notifyReady()
      }

      void window.roulette
        .getSettings()
        .then((config) => {
          setSettings(config)
          autoSendRef.current = config.asrAutoSend
          const ready = isConfigured(config)
          setMessages([
            {
              id: WELCOME_ID,
              role: 'assistant',
              text: ready ? t('welcome') : t('configureFirst')
            }
          ])
          if (ready && payload.action === 'voice') {
            void beginRecording()
          }
        })
        .catch((error) => {
          setMessages([
            {
              id: WELCOME_ID,
              role: 'assistant',
              text: `${t('error')}${String(error)}`
            }
          ])
        })

      requestAnimationFrame(() => inputRef.current?.focus())
    })
    return off
  }, [
    abortRecording,
    beginRecording,
    cancelAutoSend,
    history.refresh,
    t
  ])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (view !== 'chat') {
        setView('chat')
        return
      }
      if (busy) {
        window.roulette.cancelChat(sessionIdRef.current)
        return
      }
      abortRecording()
      cancelAutoSend()
      window.roulette.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [abortRecording, busy, cancelAutoSend, view])

  // Follow the conversation while it streams, but only when the user is
  // already at the bottom. Smooth scrolling is restarted for every token by
  // the provider, so streaming commits scroll instantly instead.
  useLayoutEffect(() => {
    if (view !== 'chat') {
      lastViewRef.current = view
      return
    }
    const element = listRef.current
    if (!element) {
      lastViewRef.current = view
      return
    }
    const entered = lastViewRef.current !== 'chat'
    lastViewRef.current = view
    if (!entered && !forceScrollRef.current && !nearBottomRef.current) return
    if (entered) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    } else {
      element.scrollTop = element.scrollHeight
    }
    forceScrollRef.current = false
    nearBottomRef.current = true
  }, [messages, view])

  useEffect(() => {
    if (view !== 'chat') return
    const element = listRef.current
    if (!element) return
    const update = (): void => {
      nearBottomRef.current =
        element.scrollHeight - element.scrollTop - element.clientHeight < 80
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    return () => element.removeEventListener('scroll', update)
  }, [view])

  useEffect(() => {
    if (view === 'chat') requestAnimationFrame(() => inputRef.current?.focus())
  }, [view])

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      if (autoSendTimerRef.current != null) {
        window.clearTimeout(autoSendTimerRef.current)
      }
    }
  }, [])

  const resumeSession = async (summary: SessionSummary): Promise<void> => {
    try {
      const detail = await window.roulette.getSession(summary.id)
      if (!detail) {
        showToast(t('historyMissing'))
        await history.refresh()
        return
      }
      window.roulette.cancelChat(sessionIdRef.current)
      abortRecording()
      cancelAutoSend()
      sessionIdRef.current = detail.id
      streamingIdRef.current = null
      setBusy(false)
      setAction(ACTION_BY_KIND[detail.kind] ?? 'text')
      setSessionTitle(detail.title)
      forceScrollRef.current = true
      setMessages(
        detail.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.content,
          image: message.image,
          sources: message.sources
        }))
      )
      setPendingImage(null)
      setView('chat')
      requestAnimationFrame(() => inputRef.current?.focus())
    } catch (error) {
      showToast(
        `${t('error')}${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const startNewSession = (): void => {
    resetConversation()
    setView('chat')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const openHistory = (): void => {
    setView('history')
    void history.refresh()
  }

  const openSettings = useCallback((): void => {
    const config = settings ?? {
      baseUrl: '',
      textModel: '',
      visionModel: '',
      hasApiKey: false,
      asrAutoSend: false,
      kbEnabled: true,
      webSearch: false,
      shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS)
    }
    settingsDraft.populate(config)
    setView('settings')
    setSettingsFocus(null)
    void kb.refresh()
    void window.roulette
      .getShortcuts()
      .then((info) => setShortcuts(info))
      .catch(() => setShortcuts(null))
    void window.roulette
      .getAsrStatus()
      .then((status) => setAsrStatus(status))
      .catch(() => {})
  }, [kb.refresh, settings, settingsDraft.populate])
  openSettingsRef.current = openSettings

  const openKb = (): void => {
    setView('kb')
    void kb.refresh()
  }

  const requireKbModel = (): void => {
    showToast(
      kb.status?.downloading || kb.status?.loading
        ? t('kbModelBusy')
        : t('kbNeedModel')
    )
    openSettings()
    setSettingsFocus('vector')
  }

  const closePanel = (): void => {
    abortRecording()
    cancelAutoSend()
    window.roulette.closePanel()
  }

  const downloadAsr = async (): Promise<void> => {
    try {
      setAsrStatus(await window.roulette.downloadAsrModel())
    } catch (error) {
      showToast(
        `${t('error')}${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const insertLast = (): void => {
    const last = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' &&
          !message.streaming &&
          !message.errorCode &&
          message.text.trim()
      )
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

    forceScrollRef.current = true
    setMessages((current) => [
      ...current,
      user,
      { id: assistantId, role: 'assistant', text: '', streaming: true }
    ])
    setInput('')
    setPendingImage(null)
    setBusy(true)
    setSessionTitle(
      (current) => current || (flat.length > 40 ? `${flat.slice(0, 40)}…` : flat)
    )
    streamingIdRef.current = assistantId
    window.roulette.chat({
      sessionId: sessionIdRef.current,
      kind: KIND_BY_ACTION[action],
      text,
      image
    })
  }
  sendRef.current = send

  const onKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ): void => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (busy) {
      stop()
      return
    }
    if (event.ctrlKey || event.metaKey) insertLast()
    else send()
  }

  const onInput = (value: string): void => {
    if (autoSendPending) cancelAutoSend()
    setInput(value)
  }

  const copy = useCallback(
    (text: string): void => {
      window.roulette.copyText(text)
      showToast(t('copied'))
    },
    [showToast, t]
  )

  const copySource = useCallback(
    (source: KbSource): void => {
      window.roulette.copyText(source.snippet)
      showToast(t('copied'))
    },
    [showToast, t]
  )

  const insertAtCursor = useCallback((text: string): void => {
    window.roulette.insertText(text)
  }, [])

  const asrPercent =
    asrStatus && asrStatus.totalBytes > 0
      ? Math.min(
          100,
          Math.round((asrStatus.receivedBytes / asrStatus.totalBytes) * 100)
        )
      : 0

  const welcomeText =
    messages.find((message) => message.id === WELCOME_ID)?.text ?? t('welcome')
  const configured = isConfigured(settings)

  const headerTitle =
    view === 'chat'
      ? sessionTitle || t('appName')
      : view === 'history'
        ? t('history')
        : view === 'settings'
          ? t('settings')
          : t('knowledgeBase')

  return (
    <div className={`panel view-${view}`}>
      <PanelHeader
        view={view}
        title={headerTitle}
        onBack={() => setView('chat')}
        onHistory={openHistory}
        onSettings={openSettings}
        onKb={openKb}
        onMinimize={() => window.roulette.minimizePanel()}
        onClose={closePanel}
      />

      {view === 'chat' && (
        <ChatView
          messages={messages}
          welcomeText={welcomeText}
          configured={configured}
          scrollRef={listRef}
          onInsert={insertAtCursor}
          onCopy={copy}
          onCopySource={copySource}
          onOpenSettings={openSettings}
        />
      )}

      {view === 'history' && (
        <HistoryView
          sessions={history.sessions}
          filtered={history.filtered}
          query={history.query}
          onQueryChange={history.setQuery}
          kind={history.kind}
          onKindChange={history.setKind}
          currentSessionId={sessionIdRef.current}
          onNew={startNewSession}
          onResume={(session) => void resumeSession(session)}
          onDelete={history.requestDelete}
          renamingId={history.renamingId}
          renameDraft={history.renameDraft}
          onRenameDraftChange={history.setRenameDraft}
          renameInputRef={history.renameInputRef}
          onBeginRename={history.beginRename}
          onCommitRename={history.commitRename}
          onCancelRename={history.cancelRename}
          onClearSearch={() => history.setQuery('')}
        />
      )}

      {view === 'settings' && (
        <SettingsView
          draft={settingsDraft.draft}
          setDraft={settingsDraft.setDraft}
          canSave={settingsDraft.canSave}
          onSave={() => void settingsDraft.save()}
          asrStatus={asrStatus}
          asrPercent={asrPercent}
          onDownloadAsr={() => void downloadAsr()}
          kbStatus={kb.status}
          onPrepareKb={() => void kb.prepare()}
          shortcuts={shortcuts}
          focus={settingsFocus}
        />
      )}

      {view === 'kb' && (
        <KnowledgeBaseView
          status={kb.status}
          documents={kb.documents}
          title={kb.title}
          onTitleChange={kb.setTitle}
          text={kb.text}
          onTextChange={kb.setText}
          busy={kb.busy}
          ingest={kb.ingest}
          error={kb.error}
          onAddText={() => kb.addText()}
          onAddFiles={() => void kb.addFiles()}
          onRequireModel={requireKbModel}
          onRemove={(id) => void kb.remove(id)}
        />
      )}

      {view === 'chat' && (
        <Composer
          input={input}
          inputRef={inputRef}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onSend={send}
          onStop={stop}
          busy={busy}
          pendingImage={pendingImage}
          onRemoveImage={() => setPendingImage(null)}
          onCapture={() => window.roulette.captureScreenshot()}
          recording={recording}
          recordSeconds={recordSeconds}
          level={level}
          noSound={noSound}
          transcribing={transcribing}
          autoSendPending={autoSendPending}
          onToggleRecording={() => void beginRecording()}
          onStopRecording={stopRecording}
          onCancelAutoSend={cancelAutoSend}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      {history.undoDelete && !toast && (
        <div className="toast undo-toast">
          <span>{t('sessionDeleted')}</span>
          <button
            className="undo-button"
            onClick={history.undoDeleteAction}
          >
            {t('undo')}
          </button>
        </div>
      )}
    </div>
  )
}
