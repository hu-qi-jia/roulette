import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import { useTranslation } from 'react-i18next'
import type { KbSource } from '../../../../shared/types'
import logo from '../../assets/logo.webp'
import { ArrowRightIcon, CopyIcon, GripIcon, RetryIcon } from '../../icons'
import { ACTIONABLE_ERRORS, WELCOME_ID } from '../constants'
import type { Message } from '../types'

interface ChatViewProps {
  messages: Message[]
  welcomeText: string
  configured: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  onInsert: (text: string) => void
  onCopy: (text: string) => void
  onCopySource: (source: KbSource) => void
  onRetry: (messageId: number) => void
  onOpenSettings: () => void
}

interface MessageRowProps {
  message: Message
  dragging: boolean
  canRetry: boolean
  onBeginDrag: (messageId: number, text: string) => void
  onInsert: (text: string) => void
  onCopy: (text: string) => void
  onCopySource: (source: KbSource) => void
  onRetry: (messageId: number) => void
  onOpenSettings: () => void
}

const DRAG_THRESHOLD = 6

interface PendingDrag {
  pointerId: number
  x: number
  y: number
  text: string
  started: boolean
}

// Streaming replaces only the last message object; memoizing the row keeps the
// rest of a long conversation out of the render path.
const MessageRow = memo(function MessageRow({
  message,
  dragging,
  canRetry,
  onBeginDrag,
  onInsert,
  onCopy,
  onCopySource,
  onRetry,
  onOpenSettings
}: MessageRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const pending = useRef<PendingDrag | null>(null)

  if (message.role === 'user') {
    return (
      <div className="message user">
        <div className={`query bubble ${message.image ? 'has-image' : ''}`}>
          {message.image && <img src={message.image} alt="" />}
          <p>{message.text}</p>
        </div>
      </div>
    )
  }

  const canDrag = !message.streaming && !message.errorCode && message.text.trim().length > 0

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!canDrag || event.button !== 0) return
    pending.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      text: message.text,
      started: false
    }
    // Keep receiving moves even when the pointer leaves the panel.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // The native hook still tracks the drag outside the window.
    }
    event.preventDefault()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = pending.current
    if (!drag || drag.started || drag.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return
    drag.started = true
    onBeginDrag(message.id, drag.text)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (pending.current) pending.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // The capture may already be gone.
    }
  }

  const onPointerCancel = (): void => {
    // Once the drag has started the native hook owns its lifetime: the
    // browser may cancel pointer capture when the cursor leaves the window,
    // which must not abort a drag that is still under the mouse button.
    pending.current = null
  }

  return (
    <div className="message assistant">
      <article
        className={`answer ${message.errorCode ? 'error' : ''} ${dragging ? 'dragging' : ''}`}
      >
        {message.streaming && !message.text ? (
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <p className="answer-text">
            {message.text}
            {message.streaming && message.text && (
              <span className="stream-cursor" aria-hidden="true" />
            )}
          </p>
        )}

        {!message.errorCode &&
          !message.streaming &&
          message.sources &&
          message.sources.length > 0 && (
            <div className="sources">
              {message.sources.map((source, index) => (
                <button
                  key={source.chunkId}
                  className="source"
                  title={source.snippet}
                  onClick={() => onCopySource(source)}
                >
                  <b>[{index + 1}]</b>
                  <span>{source.title}</span>
                </button>
              ))}
            </div>
          )}

        {message.errorCode ? (
          <div className="answer-actions">
            {ACTIONABLE_ERRORS.has(message.errorCode) && (
              <button className="primary" onClick={onOpenSettings}>
                {t('openSettings')}
              </button>
            )}
            {canRetry && (
              <button
                className="action-icon"
                title={t('retry')}
                aria-label={t('retry')}
                onClick={() => onRetry(message.id)}
              >
                <RetryIcon size={15} />
              </button>
            )}
          </div>
        ) : (
          !message.streaming &&
          message.text.trim() && (
            <div className="answer-actions">
              <button
                className="action-icon accent"
                title={t('insertAtCursor')}
                aria-label={t('insertAtCursor')}
                onClick={() => onInsert(message.text)}
              >
                <ArrowRightIcon size={15} />
              </button>
              <button
                className="action-icon"
                title={t('copy')}
                aria-label={t('copy')}
                onClick={() => onCopy(message.text)}
              >
                <CopyIcon size={15} />
              </button>
              {canRetry && (
                <button
                  className="action-icon"
                  title={t('retry')}
                  aria-label={t('retry')}
                  onClick={() => onRetry(message.id)}
                >
                  <RetryIcon size={15} />
                </button>
              )}
              {canDrag && (
                <span
                  className={`drag-handle ${dragging ? 'active' : ''}`}
                  title={t('dragToPasteHint')}
                  onPointerEnter={() => window.roulette.prepareTextDrag()}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                >
                  <GripIcon size={13} />
                  {dragging ? t('dragReleaseToPaste') : t('dragToPaste')}
                </span>
              )}
            </div>
          )
        )}
      </article>
    </div>
  )
})

export function ChatView({
  messages,
  welcomeText,
  configured,
  scrollRef,
  onInsert,
  onCopy,
  onCopySource,
  onRetry,
  onOpenSettings
}: ChatViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const hasConversation = messages.some((message) => message.id !== WELCOME_ID)
  const visibleMessages = messages.filter((message) => message.id !== WELCOME_ID)
  const lastMessage = visibleMessages[visibleMessages.length - 1]
  const retryableId =
    lastMessage?.role === 'assistant' && !lastMessage.streaming ? lastMessage.id : null

  useEffect(() => {
    return window.roulette.onTextDragState((active) => {
      if (!active) setDraggingId(null)
    })
  }, [])

  const beginDrag = useCallback((messageId: number, text: string): void => {
    setDraggingId(messageId)
    window.roulette.beginTextDrag(text)
  }, [])

  return (
    <main className="panel-body chat-body" ref={scrollRef}>
      {!hasConversation ? (
        <div className="empty-state">
          <img className="empty-mark" src={logo} alt="" aria-hidden="true" draggable={false} />
          <h1>{t('appName')}</h1>
          <p>{welcomeText}</p>
          <span className="empty-hint">{t('shortcutHint')}</span>
          {!configured && (
            <button className="primary empty-config" onClick={onOpenSettings}>
              {t('openSettings')}
            </button>
          )}
        </div>
      ) : (
        messages
          .filter((message) => message.id !== WELCOME_ID)
          .map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              dragging={draggingId === message.id}
              canRetry={retryableId === message.id}
              onBeginDrag={beginDrag}
              onInsert={onInsert}
              onCopy={onCopy}
              onCopySource={onCopySource}
              onRetry={onRetry}
              onOpenSettings={onOpenSettings}
            />
          ))
      )}
    </main>
  )
}
