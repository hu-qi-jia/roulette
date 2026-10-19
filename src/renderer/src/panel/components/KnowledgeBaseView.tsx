import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  KbDocumentSummary,
  KbIngestProgress,
  KbStatus
} from '../../../../shared/types'

interface KnowledgeBaseViewProps {
  status: KbStatus | null
  documents: KbDocumentSummary[]
  title: string
  onTitleChange: (title: string) => void
  text: string
  onTextChange: (text: string) => void
  busy: boolean
  ingest: KbIngestProgress | null
  error: string | null
  onAddText: () => Promise<boolean>
  onAddFiles: () => void
  onRequireModel: () => void
  onRemove: (id: number) => void
}

export function KnowledgeBaseView({
  status,
  documents,
  title,
  onTitleChange,
  text,
  onTextChange,
  busy,
  ingest,
  error,
  onAddText,
  onAddFiles,
  onRequireModel,
  onRemove
}: KnowledgeBaseViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)

  const modelReady = status?.installed === true

  const handleUpload = (): void => {
    if (!modelReady) {
      onRequireModel()
      return
    }
    if (!busy) onAddFiles()
  }

  const handleCreate = (): void => {
    if (!modelReady) {
      onRequireModel()
      return
    }
    setCreating((open) => !open)
  }

  const submitCreate = async (): Promise<void> => {
    if (busy || !text.trim()) return
    const added = await onAddText()
    if (added) setCreating(false)
  }

  return (
    <div className="page kb-page">
      <div className="kb-toolbar">
        <button className="primary" onClick={handleUpload} disabled={busy}>
          {t('kbUpload')}
        </button>
        <button
          className={`kb-secondary ${creating ? 'active' : ''}`}
          onClick={handleCreate}
        >
          {t('kbCreate')}
        </button>
      </div>

      {creating && (
        <form
          className="kb-create-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitCreate()
          }}
        >
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder={t('kbTitlePlaceholder')}
            aria-label={t('kbTitlePlaceholder')}
          />
          <textarea
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={t('kbTextPlaceholder')}
            aria-label={t('kbTextPlaceholder')}
            autoFocus
          />
          <div className="add-row">
            <button type="button" onClick={() => setCreating(false)}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || !text.trim()}
            >
              {t('kbAdd')}
            </button>
          </div>
          {busy && (
            <div className="kb-ingest">
              {ingest
                ? `${t('kbEmbedding')} ${ingest.current}/${ingest.total}`
                : `${t('kbEmbedding')}…`}
            </div>
          )}
          {error && <div className="asr-error">{error}</div>}
        </form>
      )}

      {!creating && busy && (
        <div className="kb-ingest">
          {ingest
            ? `${t('kbEmbedding')} ${ingest.current}/${ingest.total}`
            : `${t('kbEmbedding')}…`}
        </div>
      )}
      {!creating && error && <div className="asr-error">{error}</div>}

      {documents.length === 0 ? (
        <div className="page-empty">{t('kbEmpty')}</div>
      ) : (
        <div className="docs">
          {documents.map((document) => (
            <div key={document.id} className="doc">
              <b>{document.title}</b>
              <span>
                {t('kbChunks', { count: document.chunkCount })} ·{' '}
                {document.source}
              </span>
              <button
                type="button"
                title={t('delete')}
                onClick={() => onRemove(document.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
