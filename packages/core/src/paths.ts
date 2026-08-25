import { join } from 'node:path'
import { app } from 'electron'

/** %APPDATA%/<uygulama> — ayarlar, gunlukler, onbellek buraya. */
export function userDataDir(...segments: string[]): string {
  return join(app.getPath('userData'), ...segments)
}

/** Kullanicinin Resimler klasoru — ekran goruntusu varsayilani. */
export function picturesDir(...segments: string[]): string {
  return join(app.getPath('pictures'), ...segments)
}

/** Kullanicinin Videolar klasoru — kayit varsayilani. */
export function videosDir(...segments: string[]): string {
  return join(app.getPath('videos'), ...segments)
}

/** Kullanicinin Belgeler klasoru — not varsayilani. */
export function documentsDir(...segments: string[]): string {
  return join(app.getPath('documents'), ...segments)
}

/**
 * Paketlenmis uygulamada `resources/` altindaki dosyalara, gelistirmede proje
 * kokundeki `resources/` klasorune isaret eder.
 */
export function resourcePath(...segments: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, ...segments)
}

/**
 * Sablondan dosya adi uretir.
 *
 * Desteklenen alanlar: {YYYY} {MM} {DD} {HH} {mm} {ss} {app} {n}
 * Ornek: "g-snap_{YYYY}-{MM}-{DD}_{HH}{mm}{ss}" -> "g-snap_2026-08-25_174233"
 */
export function formatFileName(
  template: string,
  options: { date?: Date; app?: string; counter?: number } = {},
): string {
  const d = options.date ?? new Date()
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')

  const fields: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    app: options.app ?? app.getName(),
    n: String(options.counter ?? 1),
  }

  const named = template.replace(/\{(\w+)\}/g, (match, key: string) => fields[key] ?? match)
  return sanitizeFileName(named)
}

/** Windows'ta ayrilmis dosya adlari — uzantiyla birlikte bile kullanilamaz. */
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/** Windows dosya adinda yasak olan karakterler. */
const ILLEGAL_CHARS = /[<>:"/\\|?*]/g

/**
 * Dosya adini Windows icin guvenli hale getirir.
 * Bosluklar korunur; yalnizca yasak ve kontrol karakterleri temizlenir.
 */
export function sanitizeFileName(name: string): string {
  let safe = Array.from(name)
    // Kontrol karakterlerini (0x00-0x1F ve 0x7F) tamamen at
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code > 0x1f && code !== 0x7f
    })
    .join('')
    .replace(ILLEGAL_CHARS, '-')
    // Windows sondaki nokta ve boslugu sessizce kirpar; biz acikca yapalim
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 200)

  if (!safe) safe = 'dosya'
  if (RESERVED_NAMES.test(safe)) safe = `_${safe}`
  return safe
}
