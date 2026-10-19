import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  cloneShortcuts,
  DEFAULT_SHORTCUTS,
  normalizeShortcuts
} from '../shared/shortcuts'
import type { AppSettings, SettingsInput, ShortcutSettings } from '../shared/types'

interface StoredSettings {
  baseUrl: string
  textModel: string
  visionModel: string
  asrAutoSend: boolean
  kbEnabled: boolean
  webSearch: boolean
  shortcuts: ShortcutSettings
  apiKeyEnc?: string
}

const EMPTY: StoredSettings = {
  baseUrl: '',
  textModel: '',
  visionModel: '',
  asrAutoSend: false,
  kbEnabled: true,
  webSearch: false,
  shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS)
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadStored(): StoredSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<StoredSettings>
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      textModel: typeof parsed.textModel === 'string' ? parsed.textModel : '',
      visionModel: typeof parsed.visionModel === 'string' ? parsed.visionModel : '',
      asrAutoSend: parsed.asrAutoSend === true,
      kbEnabled: parsed.kbEnabled !== false,
      webSearch: parsed.webSearch === true,
      shortcuts: normalizeShortcuts(parsed.shortcuts) ?? cloneShortcuts(DEFAULT_SHORTCUTS),
      apiKeyEnc: typeof parsed.apiKeyEnc === 'string' ? parsed.apiKeyEnc : undefined
    }
  } catch {
    return { ...EMPTY, shortcuts: cloneShortcuts(EMPTY.shortcuts) }
  }
}

function writeStored(next: StoredSettings): void {
  const file = settingsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(temp, file)
}

function envValue(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

export function getPublicSettings(): AppSettings {
  const stored = loadStored()
  const envKey = envValue('ROULETTE_API_KEY')
  return {
    baseUrl: envValue('ROULETTE_BASE_URL') ?? stored.baseUrl,
    textModel: envValue('ROULETTE_TEXT_MODEL') ?? stored.textModel,
    visionModel: envValue('ROULETTE_VISION_MODEL') ?? stored.visionModel,
    hasApiKey: Boolean(envKey || stored.apiKeyEnc),
    asrAutoSend: stored.asrAutoSend,
    kbEnabled: stored.kbEnabled,
    webSearch: stored.webSearch,
    shortcuts: cloneShortcuts(stored.shortcuts)
  }
}

export function getApiKey(): string | null {
  const envKey = envValue('ROULETTE_API_KEY')
  if (envKey) return envKey

  const stored = loadStored()
  if (!stored.apiKeyEnc) return null

  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(stored.apiKeyEnc, 'base64'))
  } catch {
    return null
  }
}

export function saveSettings(input: SettingsInput): AppSettings {
  const stored = loadStored()
  stored.baseUrl = input.baseUrl.trim()
  stored.textModel = input.textModel.trim()
  stored.visionModel = input.visionModel.trim()
  if (typeof input.asrAutoSend === 'boolean') {
    stored.asrAutoSend = input.asrAutoSend
  }
  if (typeof input.kbEnabled === 'boolean') {
    stored.kbEnabled = input.kbEnabled
  }
  if (typeof input.webSearch === 'boolean') {
    stored.webSearch = input.webSearch
  }
  if (input.shortcuts) {
    const normalized = normalizeShortcuts(input.shortcuts)
    if (normalized) stored.shortcuts = normalized
  }

  if (typeof input.apiKey === 'string') {
    const apiKey = input.apiKey.trim()
    if (apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS credential encryption is unavailable; the API key was not saved.')
      }
      stored.apiKeyEnc = safeStorage.encryptString(apiKey).toString('base64')
    } else {
      delete stored.apiKeyEnc
    }
  }

  writeStored(stored)
  return getPublicSettings()
}
