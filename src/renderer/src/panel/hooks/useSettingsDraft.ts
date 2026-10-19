import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, SettingsInput } from '../../../../shared/types'

export interface SettingsDraft {
  baseUrl: string
  apiKey: string
  keyDirty: boolean
  textModel: string
  visionModel: string
  asrAutoSend: boolean
  kbEnabled: boolean
  showApiKey: boolean
}

interface UseSettingsDraftOptions {
  onSaved: (settings: AppSettings) => void
  onToast: (message: string) => void
}

export function useSettingsDraft({
  onSaved,
  onToast
}: UseSettingsDraftOptions): {
  draft: SettingsDraft
  setDraft: (patch: Partial<SettingsDraft>) => void
  populate: (settings: AppSettings) => void
  save: () => Promise<void>
  canSave: boolean
} {
  const { t } = useTranslation()
  const [draft, setDraftState] = useState<SettingsDraft>({
    baseUrl: '',
    apiKey: '',
    keyDirty: false,
    textModel: '',
    visionModel: '',
    asrAutoSend: false,
    kbEnabled: true,
    showApiKey: false
  })

  const setDraft = useCallback((patch: Partial<SettingsDraft>): void => {
    setDraftState((current) => ({ ...current, ...patch }))
  }, [])

  const populate = useCallback((settings: AppSettings): void => {
    setDraftState({
      baseUrl: settings.baseUrl,
      apiKey: '',
      keyDirty: false,
      textModel: settings.textModel || settings.visionModel,
      visionModel: settings.visionModel || settings.textModel,
      asrAutoSend: settings.asrAutoSend,
      kbEnabled: settings.kbEnabled,
      showApiKey: false
    })
    void window.roulette
      .getApiKey()
      .then((key) => setDraftState((current) => ({ ...current, apiKey: key })))
      .catch(() => {})
  }, [])

  const canSave = useMemo(
    () =>
      Boolean(
        draft.baseUrl.trim() && draft.textModel.trim() && draft.visionModel.trim()
      ),
    [draft.baseUrl, draft.textModel, draft.visionModel]
  )

  const save = useCallback(async (): Promise<void> => {
    const payload: SettingsInput = {
      baseUrl: draft.baseUrl,
      textModel: draft.textModel.trim(),
      visionModel: draft.visionModel.trim(),
      asrAutoSend: draft.asrAutoSend,
      kbEnabled: draft.kbEnabled
    }
    // Only touch the stored key when the field was edited, so a quick save
    // cannot erase a key that is still being loaded.
    if (draft.keyDirty) payload.apiKey = draft.apiKey
    try {
      const updated = await window.roulette.saveSettings(payload)
      setDraftState((current) => ({ ...current, keyDirty: false }))
      onSaved(updated)
      onToast(t('saved'))
    } catch (error) {
      onToast(`${t('error')}${error instanceof Error ? error.message : String(error)}`)
    }
  }, [draft, onSaved, onToast, t])

  return { draft, setDraft, populate, save, canSave }
}
