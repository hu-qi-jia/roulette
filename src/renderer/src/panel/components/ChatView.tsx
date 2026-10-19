import { memo, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { KbSource } from '../../../../shared/types'
import logo from '../../assets/logo.webp'
import { ArrowRightIcon } from '../../icons'
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
  onOpenSettings: () => void
}

interface MessageRowProps {
  message: Message
  onInsert: (text: string) => void
  onCopy: (text: string) => void
  onCopySource: (source: KbSource) => void
  onOpenSettings: () => void
}

// Streaming replaces only the last message object; memoizing the row keeps the
// rest of a long conversation out of the render path.
const MessageRow = memo(function MessageRow({
  message,
  onInsert,
  onCopy,
  onCopySource,
  onOpenSettings
}: MessageRowProps): React.JSX.Element {
  const { t } = useTranslation()

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

  return (
    <div className="message assistant">
      <article className={`answer ${message.errorCode ? 'error' : ''}`}>
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
          ACTIONABLE_ERRORS.has(message.errorCode) && (
            <div className="answer-actions">
              <button className="primary" onClick={onOpenSettings}>
                {t('openSettings')}
              </button>
            </div>
          )
        ) : (
          !message.streaming &&
          message.text.trim() && (
            <div className="answer-actions">
              <button className="primary" onClick={() => onInsert(message.text)}>
                {t('insertAtCursor')}
                <ArrowRightIcon size={15} />
              </button>
              <button className="ghost" onClick={() => onCopy(message.text)}>
                {t('copy')}
              </button>
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
  onOpenSettings
}: ChatViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const hasConversation = messages.some((message) => message.id !== WELCOME_ID)

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
              onInsert={onInsert}
              onCopy={onCopy}
              onCopySource={onCopySource}
              onOpenSettings={onOpenSettings}
            />
          ))
      )}
    </main>
  )
}
