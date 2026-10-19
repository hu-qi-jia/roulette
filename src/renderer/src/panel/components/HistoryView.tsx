import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionKind, SessionSummary } from '../../../../shared/types'
import { CloseIcon, PencilIcon, PlusIcon, SearchIcon } from '../../icons'
import { formatSessionTime } from '../../lib/format'
import { KIND_LABEL } from '../constants'

interface HistoryViewProps {
  sessions: SessionSummary[]
  filtered: SessionSummary[]
  query: string
  onQueryChange: (query: string) => void
  kind: SessionKind | 'all'
  onKindChange: (kind: SessionKind | 'all') => void
  currentSessionId: string
  onNew: () => void
  onResume: (session: SessionSummary) => void
  onDelete: (session: SessionSummary) => void
  renamingId: string | null
  renameDraft: string
  onRenameDraftChange: (title: string) => void
  renameInputRef: RefObject<HTMLInputElement | null>
  onBeginRename: (session: SessionSummary) => void
  onCommitRename: (id: string) => Promise<void>
  onCancelRename: () => void
  onClearSearch: () => void
}

export function HistoryView({
  sessions,
  filtered,
  query,
  onQueryChange,
  kind,
  onKindChange,
  currentSessionId,
  onNew,
  onResume,
  onDelete,
  renamingId,
  renameDraft,
  onRenameDraftChange,
  renameInputRef,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onClearSearch
}: HistoryViewProps): React.JSX.Element {
  const { t, i18n } = useTranslation()

  return (
    <div className="page history-page">
      <div className="page-head">
        <h2>{t('recentSessions')}</h2>
        <button onClick={onNew}>
          <PlusIcon size={14} />
          {t('newSession')}
        </button>
      </div>

      <div className="search history-search">
        <SearchIcon size={18} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('search')}
          aria-label={t('searchHistory')}
        />
        {query && (
          <button
            className="search-clear"
            title={t('clearSearch')}
            onClick={onClearSearch}
          >
            <CloseIcon size={16} />
          </button>
        )}
      </div>

      <div className="filters">
        {(['all', 'chat', 'screenshot', 'voice'] as const).map((value) => (
          <button
            key={value}
            className={`filter-chip ${kind === value ? 'active' : ''}`}
            onClick={() => onKindChange(value)}
          >
            {value === 'all' ? t('all') : t(KIND_LABEL[value])}
          </button>
        ))}
      </div>

      {sessions.length === 0 ? (
        <div className="page-empty">{t('emptyHistory')}</div>
      ) : filtered.length === 0 ? (
        <div className="page-empty">{t('noResults')}</div>
      ) : (
        <div className="grid">
          {filtered.map((session) => {
            const active = session.id === currentSessionId
            return (
              <article
                key={session.id}
                className={`history-item ${active ? 'active' : ''}`}
                onClick={() => {
                  if (renamingId === session.id) return
                  onResume(session)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && renamingId !== session.id) {
                    onResume(session)
                  }
                }}
                tabIndex={0}
              >
                {renamingId === session.id ? (
                  <input
                    ref={renameInputRef}
                    className="history-rename-input"
                    value={renameDraft}
                    onChange={(event) => onRenameDraftChange(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => void onCommitRename(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void onCommitRename(session.id)
                      } else if (event.key === 'Escape') {
                        event.stopPropagation()
                        onCancelRename()
                      }
                    }}
                  />
                ) : (
                  <h3 className="history-item-title">
                    {session.title || t('untitled')}
                  </h3>
                )}

                {session.preview && <p>{session.preview}</p>}
                <span>
                  {formatSessionTime(session.updatedAt, i18n.language, t)}
                </span>

                <div className="card-tools">
                  <button
                    className="history-rename"
                    title={t('rename')}
                    onClick={(event) => {
                      event.stopPropagation()
                      onBeginRename(session)
                    }}
                  >
                    <PencilIcon size={15} />
                  </button>
                  <button
                    className="history-delete"
                    title={t('delete')}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDelete(session)
                    }}
                  >
                    <CloseIcon size={15} />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
