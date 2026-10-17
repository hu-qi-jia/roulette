import type { JSX, ReactNode } from 'react'
import type { SessionKind } from '../../shared/types'

export function IconBase({
  children,
  size = 18
}: {
  children: ReactNode
  size?: number
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function ChatIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4.2A2.5 2.5 0 0 1 4 13.5Z" />
    </IconBase>
  )
}

export function HistoryIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <rect x="3.5" y="4" width="17" height="16" rx="3.5" />
      <path d="M9 4v16" />
      <path d="M12.5 9h5M12.5 13h5M12.5 17h3" />
    </IconBase>
  )
}

export function SettingsIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <path d="M4 7h9M18 7h2M4 17h2M10 17h10" />
      <circle cx="15.5" cy="7" r="2.2" />
      <circle cx="8.5" cy="17" r="2.2" />
    </IconBase>
  )
}

export function CloseIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </IconBase>
  )
}

export function PlusIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <path d="M12 5.5v13M5.5 12h13" />
    </IconBase>
  )
}

export function CameraIcon({ size = 17 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.1l1-1.6h6.8l1 1.6h1.1A2.5 2.5 0 0 1 20 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5Z" />
      <circle cx="12" cy="12" r="3.2" />
    </IconBase>
  )
}

export function MicIcon({ size = 17 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </IconBase>
  )
}

export function ArrowUpIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </IconBase>
  )
}

export function StopIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  )
}

export function KindIcon({ kind }: { kind: SessionKind }): JSX.Element {
  if (kind === 'screenshot') {
    return (
      <IconBase size={15}>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="M4.5 17l4.2-4 3.3 3 2.6-2.4 4.4 4.4" />
      </IconBase>
    )
  }
  if (kind === 'voice') {
    return <MicIcon size={15} />
  }
  return <ChatIcon size={15} />
}

export function SearchIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20" />
    </IconBase>
  )
}

export function PencilIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <path d="M4 20l4.2-1 10.3-10.3a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" />
      <path d="M13.5 6.5l3 3" />
    </IconBase>
  )
}

export function EyeIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </IconBase>
  )
}

export function EyeOffIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <IconBase size={size}>
      <path d="M3.5 3.5l17 17" />
      <path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17.4 17.4 0 0 1-3.2 3.7" />
      <path d="M6.5 6.7A16.7 16.7 0 0 0 2.5 12s3.5 6 9.5 6a9.9 9.9 0 0 0 4.4-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </IconBase>
  )
}

export function WheelMark({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9.2"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.4"
      />
      <path
        d="M12 2.8v18.4M2.8 12h18.4"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="1.1"
      />
      <circle cx="12" cy="12" r="3.1" fill="#22c55e" />
    </svg>
  )
}
