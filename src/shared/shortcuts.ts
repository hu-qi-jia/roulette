import type { ShortcutAction, ShortcutSettings } from './types'

export const ACTIONS: ShortcutAction[] = ['hold', 'click', 'history']

export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  hold: ['Alt', 'MouseRight'],
  click: ['Control', 'Shift', 'Space'],
  history: ['Control', 'Alt', 'H']
}

export const MODIFIER_TOKENS = ['Control', 'Alt', 'Shift', 'Super'] as const
export const MOUSE_TOKENS = [
  'MouseLeft',
  'MouseMiddle',
  'MouseRight',
  'MouseX1',
  'MouseX2'
] as const

const NAMED_KEYS = [
  'Space',
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right'
]

const KEY_TOKENS = new Set<string>([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
  ...Array.from({ length: 10 }, (_, index) => `num${index}`),
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  ...NAMED_KEYS,
  ...MOUSE_TOKENS
])

const ALIASES: Record<string, string> = {
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
  cmd: 'Super',
  command: 'Super',
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  del: 'Delete',
  spacebar: 'Space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  mouseleft: 'MouseLeft',
  mouse1: 'MouseLeft',
  leftclick: 'MouseLeft',
  mousemiddle: 'MouseMiddle',
  mouse2: 'MouseMiddle',
  middleclick: 'MouseMiddle',
  mouseright: 'MouseRight',
  mouse3: 'MouseRight',
  rightclick: 'MouseRight',
  mousex1: 'MouseX1',
  mouse4: 'MouseX1',
  mousex2: 'MouseX2',
  mouse5: 'MouseX2'
}

export function isModifierToken(token: string): boolean {
  return (MODIFIER_TOKENS as readonly string[]).includes(token)
}

export function isMouseToken(token: string): boolean {
  return (MOUSE_TOKENS as readonly string[]).includes(token)
}

function normalizeToken(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (ALIASES[lower]) return ALIASES[lower]
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase()
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase()
  if (/^[0-9]$/.test(lower)) return lower
  if (/^num[0-9]$/.test(lower)) return lower
  const named = NAMED_KEYS.find((key) => key.toLowerCase() === lower)
  return named ?? null
}

/** Canonical form: modifiers first, then exactly one key or mouse button. */
export function normalizeBinding(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) return null
  const tokens: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const token = normalizeToken(entry)
    if (!token) return null
    if (!tokens.includes(token)) tokens.push(token)
  }
  if (tokens.length === 0 || tokens.length > 3) return null
  const modifiers = MODIFIER_TOKENS.filter((token) => tokens.includes(token))
  const keys = tokens.filter((token) => !isModifierToken(token))
  if (keys.length !== 1 || !KEY_TOKENS.has(keys[0])) return null
  return [...modifiers, keys[0]]
}

export function normalizeShortcuts(value: unknown): ShortcutSettings | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const hold = normalizeBinding(source.hold)
  const click = normalizeBinding(source.click)
  const history = normalizeBinding(source.history)
  if (!hold || !click || !history) return null
  return { hold, click, history }
}

export function cloneShortcuts(shortcuts: ShortcutSettings): ShortcutSettings {
  return {
    hold: [...shortcuts.hold],
    click: [...shortcuts.click],
    history: [...shortcuts.history]
  }
}

export type ShortcutErrorCode =
  | 'invalid'
  | 'require-mouse'
  | 'left-needs-modifier'
  | 'conflict'

export function sameBinding(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index])
}

export function validateShortcuts(
  shortcuts: ShortcutSettings
): Partial<Record<ShortcutAction, ShortcutErrorCode>> {
  const errors: Partial<Record<ShortcutAction, ShortcutErrorCode>> = {}

  for (const action of ACTIONS) {
    const binding = shortcuts[action]
    if (!Array.isArray(binding) || binding.length === 0 || binding.length > 3) {
      errors[action] = 'invalid'
      continue
    }
    if (binding.includes('MouseLeft') && !binding.some(isModifierToken)) {
      errors[action] = 'left-needs-modifier'
    }
    if (action === 'hold' && !binding.some(isMouseToken)) {
      errors[action] = 'require-mouse'
    }
  }

  for (let index = 0; index < ACTIONS.length; index += 1) {
    for (let other = index + 1; other < ACTIONS.length; other += 1) {
      const left = ACTIONS[index]
      const right = ACTIONS[other]
      if (sameBinding(shortcuts[left], shortcuts[right])) {
        errors[left] = errors[left] ?? 'conflict'
        errors[right] = errors[right] ?? 'conflict'
      }
    }
  }

  return errors
}

/** Electron accelerator for a keyboard binding, or null for mouse bindings. */
export function toAccelerator(binding: string[]): string | null {
  const key = binding.find((token) => !isModifierToken(token))
  if (!key || isMouseToken(key)) return null
  return binding.join('+')
}

/** Bit mask: Control=1, Alt=2, Shift=4, Super=8. */
export function modifierMask(binding: string[]): number {
  let mask = 0
  if (binding.includes('Control')) mask |= 1
  if (binding.includes('Alt')) mask |= 2
  if (binding.includes('Shift')) mask |= 4
  if (binding.includes('Super')) mask |= 8
  return mask
}

/** Button codes shared with the Rust hook: left=1, right=2, middle=3, X1=4, X2=5. */
export function mouseButtonCode(binding: string[]): number {
  const button = binding.find(isMouseToken)
  switch (button) {
    case 'MouseLeft':
      return 1
    case 'MouseRight':
      return 2
    case 'MouseMiddle':
      return 3
    case 'MouseX1':
      return 4
    case 'MouseX2':
      return 5
    default:
      return 0
  }
}

export function toHookConfig(shortcuts: ShortcutSettings): string {
  const part = (binding: string[]): string =>
    `${modifierMask(binding)} ${mouseButtonCode(binding)}`
  return `config ${part(shortcuts.hold)} ${part(shortcuts.click)} ${part(
    shortcuts.history
  )}`
}

export function describeBinding(binding: string[], language = 'en'): string {
  const zh = language.toLowerCase().startsWith('zh')
  const labels: Record<string, string> = {
    Control: 'Ctrl',
    Alt: 'Alt',
    Shift: 'Shift',
    Super: zh ? 'Win' : 'Win',
    Escape: 'Esc',
    MouseLeft: zh ? '左键' : 'Left click',
    MouseMiddle: zh ? '中键' : 'Middle click',
    MouseRight: zh ? '右键' : 'Right click',
    MouseX1: zh ? '侧键 1' : 'X1',
    MouseX2: zh ? '侧键 2' : 'X2'
  }
  return binding.map((token) => labels[token] ?? token).join(' + ')
}

/** Modifier tokens from a keyboard or mouse event's modifier flags. */
export function modifiersFromEvent(event: {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}): string[] {
  const tokens: string[] = []
  if (event.ctrlKey) tokens.push('Control')
  if (event.altKey) tokens.push('Alt')
  if (event.shiftKey) tokens.push('Shift')
  if (event.metaKey) tokens.push('Super')
  return tokens
}

/** Canonical key token for a KeyboardEvent.code, or null for modifiers/unknown. */
export function keyTokenFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  const map: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    NumpadEnter: 'Enter',
    Tab: 'Tab',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  }
  return map[code] ?? null
}

/** Canonical mouse token for a MouseEvent.button, or null. */
export function mouseTokenFromButton(button: number): string | null {
  switch (button) {
    case 0:
      return 'MouseLeft'
    case 1:
      return 'MouseMiddle'
    case 2:
      return 'MouseRight'
    case 3:
      return 'MouseX1'
    case 4:
      return 'MouseX2'
    default:
      return null
  }
}

