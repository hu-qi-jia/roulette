import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  describeBinding,
  isMouseToken,
  keyTokenFromCode,
  modifiersFromEvent,
  mouseTokenFromButton
} from '../../../../shared/shortcuts'

interface ShortcutInputProps {
  label: string
  value: string[]
  onChange: (binding: string[]) => void
  requireMouse?: boolean
  hint?: string
  error?: string | null
}

export function ShortcutInput({
  label,
  value,
  onChange,
  requireMouse = false,
  hint,
  error
}: ShortcutInputProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [recording, setRecording] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const recordingRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const stop = (cancel: boolean): void => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setRecording(false)
    setNotice(null)
    if (cancel) setNotice(null)
    window.roulette.setShortcutCapture(false)
  }

  useEffect(() => {
    recordingRef.current = recording
  }, [recording])

  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current = false
        window.roulette.setShortcutCapture(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!recording) return

    const commit = (tokens: string[]): void => {
      if (tokens.length > 3) {
        setNotice(t('shortcutMaxKeys'))
        return
      }
      if (requireMouse && !tokens.some(isMouseToken)) {
        setNotice(t('shortcutNeedsMouse'))
        return
      }
      onChangeRef.current(tokens)
      recordingRef.current = false
      setRecording(false)
      setNotice(null)
      window.roulette.setShortcutCapture(false)
    }

    const cancel = (): void => {
      recordingRef.current = false
      setRecording(false)
      setNotice(null)
      window.roulette.setShortcutCapture(false)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (event.key === 'Escape') {
        cancel()
        return
      }
      const key = keyTokenFromCode(event.code)
      if (!key) return // Modifier-only press; wait for the real key.
      commit([...modifiersFromEvent(event), key])
    }

    const onMouseDown = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (buttonRef.current?.contains(event.target as Node)) {
        cancel()
        return
      }
      const button = mouseTokenFromButton(event.button)
      if (!button) return
      commit([...modifiersFromEvent(event), button])
    }

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [recording, requireMouse, t])

  const start = (): void => {
    setNotice(null)
    setRecording(true)
    recordingRef.current = true
    window.roulette.setShortcutCapture(true)
  }

  return (
    <div className="shortcut-item">
      <div className="settings-row">
        <span>{label}</span>
        <span className="grow" />
        <button
          ref={buttonRef}
          type="button"
          className={`shortcut-field ${recording ? 'recording' : ''}`}
          onClick={() => (recording ? stop(true) : start())}
        >
          {recording
            ? notice ?? t('shortcutRecording')
            : describeBinding(value, i18n.language)}
        </button>
      </div>
      {error ? (
        <div className="asr-error">{error}</div>
      ) : hint ? (
        <div className="shortcut-hint">{hint}</div>
      ) : null}
    </div>
  )
}
