import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionKind, SessionSummary } from '../../../../shared/types'

interface UseHistoryOptions {
  isCurrent: (id: string) => boolean
  onDeleteCurrent: () => void
  onRenamed: (id: string, title: string) => void
  onToast: (message: string) => void
}

interface UndoDeleteState {
  id: string
  title: string
}

export function useHistory(options: UseHistoryOptions): {
  sessions: SessionSummary[]
  filtered: SessionSummary[]
  query: string
  setQuery: (query: string) => void
  kind: SessionKind | 'all'
  setKind: (kind: SessionKind | 'all') => void
  renamingId: string | null
  renameDraft: string
  setRenameDraft: (title: string) => void
  renameInputRef: RefObject<HTMLInputElement | null>
  undoDelete: UndoDeleteState | null
  refresh: () => Promise<void>
  beginRename: (session: SessionSummary) => void
  commitRename: (id: string) => Promise<void>
  cancelRename: () => void
  requestDelete: (session: SessionSummary) => void
  undoDeleteAction: () => void
} {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<SessionKind | 'all'>('all')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [undoDelete, setUndoDelete] = useState<UndoDeleteState | null>(null)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const pendingDeleteRef = useRef<{ id: string } | null>(null)
  const deleteTimerRef = useRef<number | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameCancelledRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSessions(await window.roulette.listSessions())
    } catch (error) {
      optionsRef.current.onToast(
        `${t('error')}${error instanceof Error ? error.message : String(error)}`
      )
    }
  }, [t])

  const finalizePendingDelete = useCallback((): void => {
    const pending = pendingDeleteRef.current
    if (!pending) return
    pendingDeleteRef.current = null
    if (deleteTimerRef.current != null) {
      window.clearTimeout(deleteTimerRef.current)
      deleteTimerRef.current = null
    }
    setUndoDelete(null)
    void window.roulette.deleteSession(pending.id).catch((error) => {
      optionsRef.current.onToast(
        `${t('error')}${error instanceof Error ? error.message : String(error)}`
      )
      void refresh()
    })
  }, [refresh, t])

  const requestDelete = useCallback(
    (session: SessionSummary): void => {
      // A second delete finalizes the previous one immediately.
      finalizePendingDelete()

      if (optionsRef.current.isCurrent(session.id)) {
        optionsRef.current.onDeleteCurrent()
      }

      setSessions((current) => current.filter((item) => item.id !== session.id))
      pendingDeleteRef.current = { id: session.id }
      setUndoDelete({ id: session.id, title: session.title })
      deleteTimerRef.current = window.setTimeout(() => {
        deleteTimerRef.current = null
        const pending = pendingDeleteRef.current
        pendingDeleteRef.current = null
        setUndoDelete(null)
        if (!pending) return
        void window.roulette.deleteSession(pending.id).catch((error) => {
          optionsRef.current.onToast(
            `${t('error')}${error instanceof Error ? error.message : String(error)}`
          )
          void refresh()
        })
      }, 5000)
    },
    [finalizePendingDelete, refresh, t]
  )

  const undoDeleteAction = useCallback((): void => {
    if (!pendingDeleteRef.current) return
    pendingDeleteRef.current = null
    setUndoDelete(null)
    if (deleteTimerRef.current != null) {
      window.clearTimeout(deleteTimerRef.current)
      deleteTimerRef.current = null
    }
    void refresh()
  }, [refresh])

  const beginRename = useCallback((session: SessionSummary): void => {
    renameCancelledRef.current = false
    setRenamingId(session.id)
    setRenameDraft(session.title)
    requestAnimationFrame(() => renameInputRef.current?.focus())
  }, [])

  const commitRename = useCallback(
    async (id: string): Promise<void> => {
      if (renameCancelledRef.current) {
        renameCancelledRef.current = false
        return
      }
      const title = renameDraft.trim()
      setRenamingId(null)
      if (!title) return
      try {
        setSessions(await window.roulette.renameSession(id, title))
        optionsRef.current.onRenamed(id, title)
      } catch (error) {
        optionsRef.current.onToast(
          `${t('error')}${error instanceof Error ? error.message : String(error)}`
        )
      }
    },
    [renameDraft, t]
  )

  const cancelRename = useCallback((): void => {
    renameCancelledRef.current = true
    setRenamingId(null)
  }, [])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return sessions
      .filter((session) => {
        if (kind !== 'all' && session.kind !== kind) return false
        if (!keyword) return true
        return (
          session.title.toLowerCase().includes(keyword) ||
          session.preview.toLowerCase().includes(keyword)
        )
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [kind, query, sessions])

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current != null) window.clearTimeout(deleteTimerRef.current)
    }
  }, [])

  return {
    sessions,
    filtered,
    query,
    setQuery,
    kind,
    setKind,
    renamingId,
    renameDraft,
    setRenameDraft,
    renameInputRef,
    undoDelete,
    refresh,
    beginRename,
    commitRename,
    cancelRename,
    requestDelete,
    undoDeleteAction
  }
}
