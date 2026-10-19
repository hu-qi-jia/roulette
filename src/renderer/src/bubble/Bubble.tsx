import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import logo from '../assets/logo.webp'

interface BubbleDrag {
  pointerId: number
  startX: number
  startY: number
  winX: number
  winY: number
  moved: boolean
}

/** The floating mark: drag it to reposition, click it to toggle the panel. */
export default function Bubble(): React.JSX.Element {
  const { t } = useTranslation()
  const drag = useRef<BubbleDrag | null>(null)

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    drag.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      winX: window.screenX,
      winY: window.screenY,
      moved: false
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Dragging still works from pointer moves inside the window.
    }
    event.preventDefault()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.screenX - current.startX
    const dy = event.screenY - current.startY
    if (!current.moved && Math.hypot(dx, dy) < 4) return
    current.moved = true
    window.roulette.moveBubble(current.winX + dx, current.winY + dy)
  }

  const finish = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const current = drag.current
    drag.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // The capture may already be gone.
    }
    if (!current) return
    if (current.moved) {
      window.roulette.placeBubble()
    } else {
      window.roulette.toggleFromBubble()
    }
  }

  const onPointerCancel = (): void => {
    const current = drag.current
    drag.current = null
    if (current?.moved) window.roulette.placeBubble()
  }

  return (
    <button
      className="float-bubble"
      title={t('openRoulette')}
      aria-label={t('openRoulette')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={onPointerCancel}
    >
      <img src={logo} alt="" draggable={false} />
    </button>
  )
}
