import { en } from './en.js'
import { de } from './locales/de.js'
import { es } from './locales/es.js'
import { fr } from './locales/fr.js'
import { ja } from './locales/ja.js'
import { pt } from './locales/pt.js'
import { ru } from './locales/ru.js'
import { tr } from './locales/tr.js'
import { zh } from './locales/zh.js'

/**
 * Translation for g-snap.
 *
 * Deliberately tiny and dependency-free: this app needs one dictionary lookup
 * and `{name}` substitution, not a framework. It lives under `shared/` because
 * BOTH processes need it — the tray menu and the file dialogs are built in the
 * main process, the toolbars and settings in the renderer.
 */

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>

/**
 * The languages on offer, labelled in themselves.
 *
 * A language picker that says "German" to someone who only reads German is a
 * picker they cannot use, so every label is the endonym.
 */
export const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'tr', label: 'Türkçe' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'pt', label: 'Português (Brasil)' },
  { id: 'ru', label: 'Русский' },
  { id: 'zh', label: '简体中文' },
  { id: 'ja', label: '日本語' },
] as const

export type LocaleId = (typeof LOCALES)[number]['id']

export const DEFAULT_LOCALE: LocaleId = 'en'

export function isLocaleId(value: unknown): value is LocaleId {
  return LOCALES.some((l) => l.id === value)
}

/**
 * Loaded dictionaries.
 *
 * Imported statically, not with dynamic `import()`. The main process is
 * bundled as CommonJS, where a top-level await does not survive the transform.
 * Nine locales of ~80 short strings is about 30 KB anyway — less than the code
 * needed to load them lazily, and switching language never waits.
 */
const DICTIONARIES: Record<LocaleId, Messages> = { en, tr, de, es, fr, pt, ru, zh, ja }

let current: LocaleId = DEFAULT_LOCALE

/**
 * Switches language process-wide.
 *
 * Module-level state rather than a React context on purpose: the main process
 * has no React, and threading a context through both processes to translate
 * eighty strings would cost more than it explains. The renderer always calls
 * this alongside a state update, so the re-render that follows picks up the
 * new dictionary.
 */
export function setLocale(id: LocaleId): void {
  current = id
}

export function getLocale(): LocaleId {
  return current
}

/** Translates a key, filling `{name}` placeholders from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  // Fall back to English for a key a translator has not reached yet. The type
  // system stops that happening, but a partially-written locale should degrade
  // to readable English rather than to the raw key.
  const message = DICTIONARIES[current][key] ?? en[key]
  if (!params) return message

  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}
