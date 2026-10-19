import { useLayoutEffect } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  RefObject
} from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpIcon, CameraIcon, MicIcon, StopIcon } from '../../icons'
import { formatDuration } from '../../lib/format'

interface ComposerProps {
  input: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  onInput: (value: string) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  pendingImage: string | null
  onRemoveImage: () => void
  onCapture: () => void
  recording: boolean
  recordSeconds: number
  level: number
  noSound: boolean
  transcribing: boolean
  autoSendPending: boolean
  onToggleRecording: () => void
  onStopRecording: () => void
  onCancelAutoSend: () => void
}

export function Composer({
  input,
  inputRef,
  onInput,
  onKeyDown,
  onSend,
  onStop,
  busy,
  pendingImage,
  onRemoveImage,
  onCapture,
  recording,
  recordSeconds,
  level,
  noSound,
  transcribing,
  autoSendPending,
  onToggleRecording,
  onStopRecording,
  onCancelAutoSend
}: ComposerProps): React.JSX.Element {
  const { t } = useTranslation()

  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.max(30, Math.min(element.scrollHeight, 120))}px`
  }, [input, inputRef])

  const sendDisabled =
    !busy && ((!input.trim() && !pendingImage) || recording || transcribing)

  return (
    <footer className="composer">
      {pendingImage && (
        <div className="composer-row attach">
          <img src={pendingImage} alt="" />
          <span className="attach-name">{t('imageAttached')}</span>
          <button className="attach-remove" onClick={onRemoveImage}>
            {t('remove')}
          </button>
        </div>
      )}

      {recording && (
        <div className="composer-row">
          <span className="recording-dot" />
          <span className="recording-label">
            {t('recording')} {formatDuration(recordSeconds)}
          </span>
          <span className="level-meter" aria-hidden="true">
            <span
              className="level-fill"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </span>
          {noSound && <span className="no-sound">{t('noSound')}</span>}
          <button className="ghost" onClick={onStopRecording}>
            {t('stopRecording')}
          </button>
        </div>
      )}

      {autoSendPending && (
        <div className="composer-row">
          <span className="spinner" />
          <span>{t('autoSending')}</span>
          <button className="ghost" onClick={onCancelAutoSend}>
            {t('cancel')}
          </button>
        </div>
      )}

      {transcribing && (
        <div className="composer-row">
          <span className="spinner" />
          <span>{t('transcribing')}</span>
        </div>
      )}

      <div className="composer-line">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          spellCheck={false}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={onKeyDown}
        />

        <div className="composer-tools">
          <button className="tool" title={t('shot')} onClick={onCapture}>
            <CameraIcon />
          </button>
          <button
            className={`tool ${recording ? 'recording' : ''}`}
            title={recording ? t('stopRecording') : t('voiceLabel')}
            onClick={recording ? onStopRecording : onToggleRecording}
            disabled={transcribing}
          >
            <MicIcon />
          </button>
        </div>

        <button
          className={busy ? 'send stop' : 'send'}
          title={busy ? t('stop') : t('send')}
          onClick={() => {
            if (busy) onStop()
            else onSend()
          }}
          disabled={sendDisabled}
        >
          {busy ? <StopIcon /> : <ArrowUpIcon />}
        </button>
      </div>
    </footer>
  )
}
