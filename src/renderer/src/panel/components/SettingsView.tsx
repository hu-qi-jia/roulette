import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { AsrStatus, KbStatus, ShortcutInfo } from '../../../../shared/types'
import { EyeIcon, EyeOffIcon } from '../../icons'
import type { SettingsDraft } from '../hooks/useSettingsDraft'
import { Toggle } from './Toggle'

interface SettingsViewProps {
  draft: SettingsDraft
  setDraft: (patch: Partial<SettingsDraft>) => void
  canSave: boolean
  onSave: () => void
  asrStatus: AsrStatus | null
  asrPercent: number
  onDownloadAsr: () => void
  kbStatus: KbStatus | null
  onPrepareKb: () => void
  shortcuts: ShortcutInfo | null
  focus: 'vector' | null
}

function formatAccelerator(value: string | null, fallback: string): string {
  if (!value) return fallback
  return value.replace(/\bControl\b/g, 'Ctrl').replace(/\+/g, ' + ')
}

export function SettingsView({
  draft,
  setDraft,
  canSave,
  onSave,
  asrStatus,
  asrPercent,
  onDownloadAsr,
  kbStatus,
  onPrepareKb,
  shortcuts,
  focus
}: SettingsViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const vectorRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (focus === 'vector') {
      vectorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [focus])

  const voiceText = asrStatus?.downloading
    ? `${t('asrDownloading')} ${asrPercent}%`
    : asrStatus?.installed
      ? t('asrReady')
      : t('asrMissing')
  const voiceDot = asrStatus?.downloading
    ? 'busy'
    : asrStatus?.installed
      ? ''
      : 'missing'

  const kbPercent =
    kbStatus && kbStatus.totalBytes > 0
      ? Math.min(
          100,
          Math.round((kbStatus.receivedBytes / kbStatus.totalBytes) * 100)
        )
      : Math.round((kbStatus?.progress ?? 0) * 100)
  const kbText = kbStatus?.downloading
    ? `${t('kbPreparing')} ${kbPercent}%`
    : kbStatus?.loading
      ? t('kbLoading')
      : kbStatus?.installed
        ? t('kbReady')
        : t('kbModelMissing')
  const kbDot =
    kbStatus?.downloading || kbStatus?.loading
      ? 'busy'
      : kbStatus?.installed
        ? ''
        : 'missing'

  return (
    <div className="page settings-page">
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) onSave()
        }}
      >
        <section className="settings-block">
          <h3 className="settings-block-title">LLM</h3>

          <div className="field">
            <label htmlFor="settings-base-url">{t('baseUrl')}</label>
            <input
              id="settings-base-url"
              value={draft.baseUrl}
              onChange={(event) => setDraft({ baseUrl: event.target.value })}
              placeholder="https://api.openai.com/v1"
              autoFocus={focus !== 'vector'}
              spellCheck={false}
            />
          </div>

          <div className="field">
            <label htmlFor="settings-api-key">{t('apiKey')}</label>
            <div className="input-with-action">
              <input
                id="settings-api-key"
                type={draft.showApiKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(event) =>
                  setDraft({ apiKey: event.target.value, keyDirty: true })
                }
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="input-action"
                title={draft.showApiKey ? t('hideKey') : t('showKey')}
                onClick={() => setDraft({ showApiKey: !draft.showApiKey })}
              >
                {draft.showApiKey ? (
                  <EyeOffIcon size={18} />
                ) : (
                  <EyeIcon size={18} />
                )}
              </button>
            </div>
          </div>

          <div className="split">
            <div className="field">
              <label htmlFor="settings-text-model">{t('textModel')}</label>
              <input
                id="settings-text-model"
                value={draft.textModel}
                onChange={(event) => setDraft({ textModel: event.target.value })}
                placeholder="gpt-4o-mini"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label htmlFor="settings-vision-model">{t('visionModel')}</label>
              <input
                id="settings-vision-model"
                value={draft.visionModel}
                onChange={(event) => setDraft({ visionModel: event.target.value })}
                placeholder="qwen-vl-plus"
                spellCheck={false}
              />
            </div>
          </div>
        </section>

        <section className="settings-block">
          <h3 className="settings-block-title">{t('voiceModel')}</h3>

          <div className="settings-row">
            <span className={`dot ${voiceDot}`} />
            <span>{voiceText}</span>
            <span className="grow" />
            {!asrStatus?.installed && !asrStatus?.downloading && (
              <button type="button" className="ghost" onClick={onDownloadAsr}>
                {t('downloadModel')}
              </button>
            )}
          </div>

          {asrStatus?.downloading && (
            <div className="progress">
              <div className="progress-fill" style={{ width: `${asrPercent}%` }} />
            </div>
          )}

          {asrStatus?.error && <div className="asr-error">{asrStatus.error}</div>}

          <div className="settings-row">
            <span>{t('autoSend')}</span>
            <span className="grow" />
            <Toggle
              checked={draft.asrAutoSend}
              label={t('autoSend')}
              onChange={() => setDraft({ asrAutoSend: !draft.asrAutoSend })}
            />
          </div>
        </section>

        <section className="settings-block" ref={vectorRef}>
          <h3 className="settings-block-title">{t('vectorModel')}</h3>

          <div className="settings-row">
            <span className={`dot ${kbDot}`} />
            <span>{kbText}</span>
            <span className="grow" />
            {kbStatus?.installed && kbStatus.modelId && (
              <span className="model-id">{kbStatus.modelId}</span>
            )}
            {!kbStatus?.installed &&
              !kbStatus?.downloading &&
              !kbStatus?.loading && (
                <button type="button" className="ghost" onClick={onPrepareKb}>
                  {t('kbDownloadModel')}
                </button>
              )}
          </div>

          {kbStatus?.downloading && (
            <div className="progress">
              <div className="progress-fill" style={{ width: `${kbPercent}%` }} />
            </div>
          )}

          {kbStatus?.error && <div className="asr-error">{kbStatus.error}</div>}

          <div className="settings-row">
            <span>{t('kbUseInChat')}</span>
            <span className="grow" />
            <Toggle
              checked={draft.kbEnabled}
              label={t('kbUseInChat')}
              onChange={() => setDraft({ kbEnabled: !draft.kbEnabled })}
            />
          </div>
        </section>

        <section className="settings-block">
          <h3 className="settings-block-title">{t('shortcuts')}</h3>

          <div className="settings-row">
            <span>{t('holdShortcut')}</span>
            <span className="grow" />
            <kbd>
              {shortcuts?.hold ? t('holdShortcutValue') : t('notAvailable')}
            </kbd>
          </div>

          <div className="settings-row">
            <span>{t('clickShortcut')}</span>
            <span className="grow" />
            <kbd>{formatAccelerator(shortcuts?.click ?? null, t('notAvailable'))}</kbd>
          </div>

          <div className="settings-row">
            <span>{t('historyShortcut')}</span>
            <span className="grow" />
            <kbd>{formatAccelerator(shortcuts?.history ?? null, t('notAvailable'))}</kbd>
          </div>
        </section>

        <button type="submit" className="save" disabled={!canSave}>
          {t('save')}
        </button>
      </form>
    </div>
  )
}
