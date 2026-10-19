import { useTranslation } from 'react-i18next'
import logo from '../../assets/logo.webp'
import {
  BackIcon,
  CloseIcon,
  DatabaseIcon,
  HistoryIcon,
  MinimizeIcon,
  PinIcon,
  PinOffIcon,
  SettingsIcon
} from '../../icons'
import type { PanelView } from '../types'

interface PanelHeaderProps {
  view: PanelView
  title: string
  pinned: boolean
  onBack: () => void
  onHistory: () => void
  onSettings: () => void
  onKb: () => void
  onTogglePin: () => void
  onMinimize: () => void
  onClose: () => void
}

export function PanelHeader({
  view,
  title,
  pinned,
  onBack,
  onHistory,
  onSettings,
  onKb,
  onTogglePin,
  onMinimize,
  onClose
}: PanelHeaderProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <header className="panel-bar">
      {view === 'chat' ? (
        <img className="logo" src={logo} alt="" aria-hidden="true" draggable={false} />
      ) : (
        <button className="icon back-button" title={t('back')} onClick={onBack}>
          <BackIcon />
        </button>
      )}

      <span className="session-title" title={title}>
        {title}
      </span>

      {view === 'chat' && (
        <>
          <button
            className="icon history-button"
            title={t('history')}
            onClick={onHistory}
          >
            <HistoryIcon />
          </button>
          <button
            className="icon kb-button"
            title={t('knowledgeBase')}
            onClick={onKb}
          >
            <DatabaseIcon />
          </button>
          <button
            className="icon settings-button"
            title={t('settings')}
            onClick={onSettings}
          >
            <SettingsIcon />
          </button>
        </>
      )}

      {view === 'history' && (
        <button
          className="icon settings-button"
          title={t('settings')}
          onClick={onSettings}
        >
          <SettingsIcon />
        </button>
      )}

      {view === 'settings' && (
        <button
          className="icon history-button"
          title={t('history')}
          onClick={onHistory}
        >
          <HistoryIcon />
        </button>
      )}

      {view === 'kb' && (
        <button
          className="icon settings-button"
          title={t('settings')}
          onClick={onSettings}
        >
          <SettingsIcon />
        </button>
      )}

      <button
        className={`icon pin-button ${pinned ? 'active' : ''}`}
        title={pinned ? t('unpinWindow') : t('pinWindow')}
        aria-pressed={pinned}
        onClick={onTogglePin}
      >
        {pinned ? <PinIcon /> : <PinOffIcon />}
      </button>

      <button
        className="icon minimize-button"
        title={t('minimize')}
        onClick={onMinimize}
      >
        <MinimizeIcon />
      </button>

      <button className="icon close" title={t('close')} onClick={onClose}>
        <CloseIcon />
      </button>
    </header>
  )
}
