import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  KbDocumentSummary,
  KbIngestProgress,
  KbStatus
} from '../../../../shared/types'

interface UseKnowledgeBaseOptions {
  onToast: (message: string) => void
}

export function useKnowledgeBase({
  onToast
}: UseKnowledgeBaseOptions): {
  status: KbStatus | null
  documents: KbDocumentSummary[]
  title: string
  setTitle: (title: string) => void
  text: string
  setText: (text: string) => void
  busy: boolean
  ingest: KbIngestProgress | null
  error: string | null
  refresh: () => Promise<void>
  prepare: () => Promise<void>
  addText: () => Promise<boolean>
  addFiles: () => Promise<void>
  remove: (id: number) => Promise<void>
} {
  const { t } = useTranslation()
  const [status, setStatus] = useState<KbStatus | null>(null)
  const [documents, setDocuments] = useState<KbDocumentSummary[]>([])
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [ingest, setIngest] = useState<KbIngestProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onToastRef = useRef(onToast)
  onToastRef.current = onToast

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextDocuments, nextStatus] = await Promise.all([
        window.roulette.listKbDocuments(),
        window.roulette.getKbStatus()
      ])
      setDocuments(nextDocuments)
      setStatus(nextStatus)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  const prepare = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setStatus(await window.roulette.prepareKb())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  const addText = useCallback(async (): Promise<boolean> => {
    const content = text.trim()
    if (!content || busy) return false
    setBusy(true)
    setError(null)
    setIngest(null)
    try {
      const document = await window.roulette.addKbText({
        title: title.trim(),
        text: content
      })
      if (!document) {
        setError(t('kbInvalid'))
        return false
      }
      setTitle('')
      setText('')
      await refresh()
      onToastRef.current(t('kbAdded'))
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      return false
    } finally {
      setBusy(false)
      setIngest(null)
    }
  }, [busy, refresh, t, text, title])

  const addFiles = useCallback(async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    setIngest(null)
    try {
      const added = await window.roulette.addKbFiles()
      await refresh()
      if (added.length > 0) {
        onToastRef.current(t('kbFilesAdded', { count: added.length }))
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
      setIngest(null)
    }
  }, [busy, refresh, t])

  const remove = useCallback(async (id: number): Promise<void> => {
    try {
      setDocuments(await window.roulette.deleteKbDocument(id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const offStatus = window.roulette.onKbProgress((next) => setStatus(next))
    const offIngest = window.roulette.onKbIngestProgress((progress) =>
      setIngest(progress)
    )
    return () => {
      offStatus()
      offIngest()
    }
  }, [refresh])

  return {
    status,
    documents,
    title,
    setTitle,
    text,
    setText,
    busy,
    ingest,
    error,
    refresh,
    prepare,
    addText,
    addFiles,
    remove
  }
}
