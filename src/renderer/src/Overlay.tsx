import { useEffect, useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { Sector, WheelMode, WheelResult } from '../../shared/types'
import {
  CameraIcon,
  ChatIcon,
  CloseIcon,
  HistoryIcon,
  MicIcon,
  WheelMark
} from './icons'

const CX = 210
const CY = 210
const R_OUTER = 180
const R_INNER = 76
const R_CONTENT = 128
const R_TRACK = 192
const R_HALO = 208
const SECTOR_GAP = 1.8

interface WheelSector {
  id: Sector
  start: number
  end: number
  labelKey: string
  Icon: (props: { size?: number }) => JSX.Element
}

const SECTORS: WheelSector[] = [
  { id: 'text', start: 225, end: 315, labelKey: 'text', Icon: ChatIcon },
  { id: 'screenshot', start: 135, end: 225, labelKey: 'shot', Icon: CameraIcon },
  { id: 'voice', start: 315, end: 405, labelKey: 'voiceLabel', Icon: MicIcon },
  { id: 'history', start: 45, end: 135, labelKey: 'history', Icon: HistoryIcon }
]

function point(radius: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)]
}

function arcPath(start: number, end: number): string {
  const from = start + SECTOR_GAP
  const to = end - SECTOR_GAP
  const [x1, y1] = point(R_OUTER, from)
  const [x2, y2] = point(R_OUTER, to)
  const [x3, y3] = point(R_INNER, to)
  const [x4, y4] = point(R_INNER, from)
  const large = to - from > 180 ? 1 : 0
  return [
    `M ${x1} ${y1}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${x4} ${y4}`,
    'Z'
  ].join(' ')
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

  const paths = useMemo(() => {
    const map = {} as Record<Sector, string>
    for (const sector of SECTORS) map[sector.id] = arcPath(sector.start, sector.end)
    return map
  }, [])

  useEffect(() => {
    const offShow = window.roulette.onWheelShow((payload) => {
      setMode(payload.mode)
      setVisible(true)
      setHovered(null)
      setResult(null)
    })

    const offMove = window.roulette.onWheelMove((payload) => {
      setHovered(payload.distance < R_INNER ? 'cancel' : sectorForAngle(payload.angle))
    })

    const offResult = window.roulette.onWheelResult((r) => {
      setResult(r)
      setHovered(r)
    })

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.roulette.cancelWheel()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      offShow()
      offMove()
      offResult()
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
    result && result !== 'cancel' ? SECTORS.find((sector) => sector.id === result) : null
  const hoveredSector =
    hovered && hovered !== 'cancel'
      ? SECTORS.find((sector) => sector.id === hovered)
      : null
  const hubSector = selected ?? hoveredSector
  const hubCancelling = result === 'cancel' || (!result && hovered === 'cancel')
  const hubTitle = hubSector ? t(hubSector.labelKey) : t('cancel')

  return (
    <div className={`overlay ${visible ? 'visible' : ''} ${mode}`}>
      <svg
        className="wheel"
        viewBox="0 0 420 420"
        xmlns="http://www.w3.org/2000/svg"
        onClick={cancel}
      >
        <defs>
          <radialGradient id="wheel-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0,0,0,0.5)" />
            <stop offset="55%" stopColor="rgba(0,0,0,0.42)" />
            <stop offset="80%" stopColor="rgba(0,0,0,0.2)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        <circle cx={CX} cy={CY} r={R_HALO} fill="url(#wheel-halo)" />
        <circle className="wheel-track" cx={CX} cy={CY} r={R_TRACK} />

        {SECTORS.map((sector) => {
          const active = hovered === sector.id || result === sector.id
          return (
            <path
              key={sector.id}
              d={paths[sector.id]}
              className={`sector ${active ? 'active' : ''}`}
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

        {SECTORS.map((sector) => {
          const mid = (sector.start + sector.end) / 2
          const [x, y] = point(R_CONTENT, mid)
          const rad = (mid * Math.PI) / 180
          const active = hovered === sector.id || result === sector.id
          const offset = active ? 4 : 0
          return (
            <g key={sector.id} transform={`translate(${x} ${y})`}>
              <g
                className={`sector-content ${active ? 'active' : ''}`}
                style={{
                  transform: `translate(${Math.cos(rad) * offset}px, ${
                    Math.sin(rad) * offset
                  }px)`
                }}
              >
                <g transform="translate(-11 -24)">
                  <sector.Icon size={22} />
                </g>
                <text className="sector-label" y="16">
                  {t(sector.labelKey)}
                </text>
              </g>
            </g>
          )
        })}

        <g>
          <circle
            className={`hub ${hubSector ? 'active' : ''}`}
            cx={CX}
            cy={CY}
            r={64}
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
          <g
            className={`hub-icon ${hubSector ? 'active' : ''}`}
            transform={`translate(${CX - 12} ${CY - 28})`}
          >
            {hubSector ? (
              <hubSector.Icon size={24} />
            ) : hubCancelling ? (
              <CloseIcon size={22} />
            ) : (
              <WheelMark size={24} />
            )}
          </g>
          <text
            className={`hub-title ${hubSector ? 'active' : ''}`}
            x={CX}
            y={CY + 18}
          >
            {hubTitle}
          </text>
        </g>
      </svg>
    </div>
  )
}
