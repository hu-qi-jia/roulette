import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { Sector, WheelMode, WheelResult } from '../../../shared/types'
import {
  CameraIcon,
  CloseIcon,
  HistoryIcon,
  MicIcon,
  TextIcon
} from '../icons'

const CX = 210
const CY = 210
const R_RING = 153
const RING_WIDTH = 86
const ARC_WIDTH = 79
const R_LABEL = 155
const R_HUB = 68
const R_HUB_RING = 74
const R_DASH = 204
const GAP = 3
const INK = '#131313'
const ACID = '#e8ff4a'
const BLUE = '#2440ff'
const CORAL = '#ff5a3c'

interface WheelSector {
  id: Sector
  start: number
  end: number
  base: string
  labelKey: string
  Icon: (props: { size?: number }) => JSX.Element
}

const SECTORS: WheelSector[] = [
  {
    id: 'text',
    start: 225,
    end: 315,
    base: ACID,
    labelKey: 'text',
    Icon: TextIcon
  },
  {
    id: 'screenshot',
    start: 135,
    end: 225,
    base: '#ffffff',
    labelKey: 'shot',
    Icon: CameraIcon
  },
  {
    id: 'voice',
    start: 315,
    end: 405,
    base: '#e9e5d9',
    labelKey: 'voiceLabel',
    Icon: MicIcon
  },
  {
    id: 'history',
    start: 45,
    end: 135,
    base: '#fbf9f2',
    labelKey: 'history',
    Icon: HistoryIcon
  }
]

function point(radius: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)]
}

function arcPath(start: number, end: number): string {
  const from = start + GAP
  const to = end - GAP
  const [x1, y1] = point(R_RING, from)
  const [x2, y2] = point(R_RING, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${R_RING} ${R_RING} 0 ${large} 1 ${x2} ${y2}`
}

function sectorForAngle(angle: number): Sector {
  if (angle >= 225 && angle < 315) return 'text'
  if (angle >= 135 && angle < 225) return 'screenshot'
  if (angle >= 45 && angle < 135) return 'history'
  return 'voice'
}

export default function Overlay(): JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<WheelMode>('hold')
  const [visible, setVisible] = useState(false)
  const [hovered, setHovered] = useState<WheelResult | null>(null)
  const [result, setResult] = useState<WheelResult | null>(null)
  const deadZoneRef = useRef(76)

  const paths = useMemo(() => {
    const map = {} as Record<Sector, string>
    for (const sector of SECTORS) map[sector.id] = arcPath(sector.start, sector.end)
    return map
  }, [])

  useEffect(() => {
    const offShow = window.roulette.onWheelShow((payload) => {
      deadZoneRef.current = payload.deadZone
      setMode(payload.mode)
      setVisible(true)
      setHovered(null)
      setResult(null)
    })

    const offMove = window.roulette.onWheelMove((payload) => {
      setHovered(
        payload.distance < deadZoneRef.current
          ? 'cancel'
          : sectorForAngle(payload.angle)
      )
    })

    const offResult = window.roulette.onWheelResult((value) => {
      setResult(value)
      setHovered(value)
    })

    const offHide = window.roulette.onWheelHide(() => {
      // Reset while the window is hidden so the next show cannot flash the
      // previous hover/result for a frame.
      setVisible(false)
      setHovered(null)
      setResult(null)
    })

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.roulette.cancelWheel()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      offShow()
      offMove()
      offResult()
      offHide()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const pick = (sector: Sector): void => {
    if (mode === 'click') window.roulette.selectSector(sector)
  }

  const cancel = (): void => {
    if (mode === 'click') window.roulette.cancelWheel()
  }

  const selected =
    result && result !== 'cancel'
      ? SECTORS.find((sector) => sector.id === result)
      : null
  const hoveredSector =
    hovered && hovered !== 'cancel'
      ? SECTORS.find((sector) => sector.id === hovered)
      : null
  const hubSector = selected ?? hoveredSector
  const hubCancelling = !hubSector
  const hubTitle = hubSector ? t(hubSector.labelKey) : t('cancel')
  const hubSub = hubSector
    ? mode === 'hold'
      ? t('releaseToRun')
      : t('clickToRun')
    : mode === 'hold'
      ? t('releaseToCancel')
      : t('clickToCancel')

  const activeId = hubSector?.id ?? null
  const activeAngle = hubSector
    ? (hubSector.start + hubSector.end) / 2
    : null
  const HubIcon = hubSector ? hubSector.Icon : CloseIcon

  return (
    <div className={`overlay ${visible ? 'visible' : ''} ${mode}`}>
      <svg
        className="wheel"
        viewBox="0 0 420 420"
        xmlns="http://www.w3.org/2000/svg"
        onClick={cancel}
      >
        <circle
          cx={CX}
          cy={CY}
          r={R_DASH}
          fill="none"
          stroke="rgba(19,19,19,0.30)"
          strokeWidth="1"
          strokeDasharray="2 9"
        />

        <g className="wheel-shadow">
          <circle
            cx={CX}
            cy={CY}
            r={R_RING}
            fill="none"
            stroke={INK}
            strokeWidth={RING_WIDTH}
          />

          {SECTORS.map((sector) => {
            const active = activeId === sector.id
            return (
              <path
                key={sector.id}
                d={paths[sector.id]}
                className="wheel-arc"
                fill="none"
                stroke={active ? BLUE : sector.base}
                strokeWidth={ARC_WIDTH}
                strokeLinecap="butt"
                aria-label={t(sector.labelKey)}
                onMouseEnter={() => {
                  if (mode === 'click') setHovered(sector.id)
                }}
                onMouseLeave={() => {
                  if (mode === 'click') setHovered(null)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  pick(sector.id)
                }}
              />
            )
          })}

          <path
            className="wheel-star"
            d="M 355 43 L 362 57 L 376 64 L 362 71 L 355 85 L 348 71 L 334 64 L 348 57 Z"
            fill={ACID}
            stroke={INK}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </g>

        {SECTORS.map((sector) => {
          const mid = (sector.start + sector.end) / 2
          const [x, y] = point(R_LABEL, mid)
          const active = activeId === sector.id
          return (
            <g key={sector.id} transform={`translate(${x} ${y})`}>
              <g
                className={`wheel-icon ${active ? 'light' : ''}`}
                transform="translate(-11 -26)"
              >
                <sector.Icon size={22} />
              </g>
              <text
                className={`wheel-label ${active ? 'light' : ''}`}
                y="14"
              >
                {t(sector.labelKey)}
              </text>
            </g>
          )
        })}

        {activeAngle != null && (
          <g
            className="wheel-pointer"
            transform={`rotate(${activeAngle - 180} ${CX} ${CY})`}
          >
            <path
              d="M 5 200 L 15 210 L 5 220 Z"
              fill={ACID}
              stroke={INK}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </g>
        )}

        <g>
          <circle
            className="hub"
            cx={CX}
            cy={CY}
            r={R_HUB}
            fill={INK}
            onMouseEnter={() => {
              if (mode === 'click') setHovered('cancel')
            }}
            onMouseLeave={() => {
              if (mode === 'click') setHovered(null)
            }}
            onClick={(event) => {
              event.stopPropagation()
              cancel()
            }}
          />
          <circle
            className="hub-ring"
            cx={CX}
            cy={CY}
            r={R_HUB_RING}
            fill="none"
            stroke={hubCancelling ? CORAL : ACID}
            strokeWidth="2"
          />
          <g
            className="wheel-icon light"
            transform="translate(199 174)"
          >
            <HubIcon size={22} />
          </g>
          <text className="hub-title" x={CX} y={CY + 6}>
            {hubTitle}
          </text>
          <text className="hub-sub" x={CX} y={CY + 22}>
            {hubSub}
          </text>
        </g>
      </svg>
    </div>
  )
}
