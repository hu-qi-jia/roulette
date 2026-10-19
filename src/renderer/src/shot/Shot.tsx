import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Rect, ShotCompletePayload, ShotShowPayload } from '../../../shared/types'

interface Point {
  x: number
  y: number
}

const MIN_SELECTION = 4
const MAX_EDGE = 2048

function rectFrom(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

export default function Shot(): React.JSX.Element {
  const { t } = useTranslation()
  const [payload, setPayload] = useState<ShotShowPayload | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [current, setCurrent] = useState<Point | null>(null)
  const [urls, setUrls] = useState<Record<number, string>>({})
  const imagesRef = useRef<Map<number, HTMLImageElement>>(new Map())
  const urlsRef = useRef<Record<number, string>>({})

  useEffect(() => {
    const off = window.roulette.onShotShow((next) => {
      setPayload(next)
      setStart(null)
      setCurrent(null)

      const nextUrls: Record<number, string> = {}
      const images = new Map<number, HTMLImageElement>()
      for (const display of next.displays) {
        const blob = new Blob([display.image], { type: display.imageMime })
        const url = URL.createObjectURL(blob)
        nextUrls[display.id] = url
        const image = new Image()
        image.src = url
        void image.decode().catch(() => {})
        images.set(display.id, image)
      }
      for (const oldUrl of Object.values(urlsRef.current)) {
        URL.revokeObjectURL(oldUrl)
      }
      urlsRef.current = nextUrls
      setUrls(nextUrls)
      imagesRef.current = images
    })

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.roulette.cancelShot()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      off()
      window.removeEventListener('keydown', onKey)
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url)
      urlsRef.current = {}
    }
  }, [])

  useEffect(() => {
    if (!start) return

    const move = (event: MouseEvent): void => {
      setCurrent({ x: event.clientX, y: event.clientY })
    }

    const up = (event: MouseEvent): void => {
      if (event.button !== 0) return
      const finished = { x: event.clientX, y: event.clientY }
      const selection = rectFrom(start, finished)
      setStart(null)
      setCurrent(null)

      if (selection.width < MIN_SELECTION || selection.height < MIN_SELECTION) {
        window.roulette.cancelShot()
        return
      }
      // Hide the frozen screen immediately; crop/encode runs while the panel
      // opens instead of keeping a static full-screen window on top.
      window.roulette.hideShot()
      void finish(selection)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [start, payload])

  const finish = async (selection: Rect): Promise<void> => {
    if (!payload) {
      window.roulette.cancelShot()
      return
    }

    const result = await crop(selection, payload, imagesRef.current)
    if (!result) {
      window.roulette.cancelShot()
      return
    }
    window.roulette.completeShot(result)
  }

  if (!payload) {
    return (
      <div className="shot">
        <div className="shot-dim" />
      </div>
    )
  }

  const originX = payload.virtual.x
  const originY = payload.virtual.y
  const selection = start && current ? rectFrom(start, current) : null

  return (
    <div
      className="shot"
      onMouseDown={(event) => {
        if (event.button !== 0) return
        setStart({ x: event.clientX, y: event.clientY })
        setCurrent({ x: event.clientX, y: event.clientY })
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        window.roulette.cancelShot()
      }}
    >
      <div className="shot-desktop">
        {payload.displays.map((display) => (
          <img
            key={display.id}
            src={urls[display.id]}
            draggable={false}
            alt=""
            style={{
              left: display.bounds.x - originX,
              top: display.bounds.y - originY,
              width: display.bounds.width,
              height: display.bounds.height
            }}
          />
        ))}
      </div>

      {!selection && <div className="shot-dim" />}

      {selection && (
        <>
          <div
            className="shot-selection"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height
            }}
          >
            <span className="shot-corner tl" />
            <span className="shot-corner tr" />
            <span className="shot-corner bl" />
            <span className="shot-corner br" />
          </div>
          <div
            className="shot-size"
            style={{
              left: selection.x + selection.width,
              top: selection.y + selection.height + 8,
              transform: 'translateX(-100%)'
            }}
          >
            {Math.round(selection.width)} × {Math.round(selection.height)}
          </div>
        </>
      )}

      <div className="shot-hint">{t('shotHint')}</div>
    </div>
  )
}

async function crop(
  selection: Rect,
  payload: ShotShowPayload,
  images: Map<number, HTMLImageElement>
): Promise<ShotCompletePayload | null> {
  const originX = payload.virtual.x
  const originY = payload.virtual.y

  const pieces = payload.displays
    .map((display) => {
      const left = Math.max(selection.x, display.bounds.x - originX)
      const top = Math.max(selection.y, display.bounds.y - originY)
      const right = Math.min(
        selection.x + selection.width,
        display.bounds.x - originX + display.bounds.width
      )
      const bottom = Math.min(
        selection.y + selection.height,
        display.bounds.y - originY + display.bounds.height
      )
      if (right <= left || bottom <= top) return null
      return { display, left, top, right, bottom }
    })
    .filter((piece): piece is NonNullable<typeof piece> => piece !== null)

  if (pieces.length === 0) return null

  await Promise.all(
    pieces.map(async ({ display }) => {
      const image = images.get(display.id)
      if (!image || image.complete) return
      await image.decode().catch(() => {})
    })
  )

  let scale = Math.max(...pieces.map((piece) => piece.display.scaleFactor))
  const longest = Math.max(selection.width, selection.height) * scale
  if (longest > MAX_EDGE) scale *= MAX_EDGE / longest

  const width = Math.max(1, Math.round(selection.width * scale))
  const height = Math.max(1, Math.round(selection.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.imageSmoothingEnabled = true
  let drawn = 0

  for (const piece of pieces) {
    const { display } = piece
    const image = images.get(display.id)
    if (!image || image.naturalWidth === 0) continue

    const displayOriginX = display.bounds.x - originX
    const displayOriginY = display.bounds.y - originY
    const sourceX =
      ((piece.left - displayOriginX) / display.bounds.width) *
      display.imageSize.width
    const sourceY =
      ((piece.top - displayOriginY) / display.bounds.height) *
      display.imageSize.height
    const sourceWidth =
      ((piece.right - piece.left) / display.bounds.width) *
      display.imageSize.width
    const sourceHeight =
      ((piece.bottom - piece.top) / display.bounds.height) *
      display.imageSize.height

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      (piece.left - selection.x) * scale,
      (piece.top - selection.y) * scale,
      (piece.right - piece.left) * scale,
      (piece.bottom - piece.top) * scale
    )
    drawn += 1
  }

  if (drawn === 0) return null

  return {
    image: canvas.toDataURL('image/jpeg', 0.85),
    width,
    height
  }
}
