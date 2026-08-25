import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { app } from 'electron'
import { readJson, writeJson } from '../fs/atomicWrite.js'

export interface SettingsStoreOptions<T extends object> {
  /** userData altindaki dosya adi. Varsayilan: settings.json */
  fileName?: string
  /** Hicbir sey kayitli degilken kullanilacak degerler. */
  defaults: T
  /**
   * Eski surumden yeni surume tasima. `version` diske yazilan surum numarasi,
   * `raw` ham JSON. Yeni sekilde nesne dondurun.
   */
  migrate?: (raw: Record<string, unknown>, version: number) => Partial<T>
  /** Guncel sema surumu. Artirilinca migrate calisir. */
  version?: number
}

interface Persisted<T> {
  __version: number
  values: T
}

/**
 * Uygulama ayarlarini userData altinda tek bir JSON dosyasinda tutar.
 *
 * - Yazma atomik (yarim yazilmis dosya olusmaz)
 * - Yazmalar 200 ms geciktirilerek toplanir (ayar penceresinde her tusa basista
 *   diske gitmemek icin)
 * - `change` olayi degisen anahtarlarla yayinlanir
 *
 * Kullanim:
 *   const store = new SettingsStore({ defaults: DEFAULTS, version: 1 })
 *   await store.load()
 *   store.get('hotkey')
 *   store.set({ hotkey: 'Ctrl+Shift+S' })
 */
export class SettingsStore<T extends object> extends EventEmitter {
  private readonly filePath: string
  private readonly defaults: T
  private readonly version: number
  private readonly migrate?: SettingsStoreOptions<T>['migrate']

  private values: T
  private flushTimer: NodeJS.Timeout | null = null
  private pendingFlush: Promise<void> | null = null

  constructor(options: SettingsStoreOptions<T>) {
    super()
    this.defaults = options.defaults
    this.version = options.version ?? 1
    this.migrate = options.migrate
    this.values = { ...options.defaults }
    this.filePath = join(app.getPath('userData'), options.fileName ?? 'settings.json')
  }

  get path(): string {
    return this.filePath
  }

  /** Diskten okur. Uygulama acilisinda bir kez cagrilmali. */
  async load(): Promise<T> {
    const raw = await readJson<Partial<Persisted<T>> & Record<string, unknown>>(this.filePath, {})

    let stored: Partial<T> = {}
    if (raw && typeof raw === 'object' && 'values' in raw && raw.values) {
      stored = raw.values as Partial<T>
      const storedVersion = typeof raw.__version === 'number' ? raw.__version : 0
      if (storedVersion < this.version && this.migrate) {
        stored = { ...stored, ...this.migrate(stored as Record<string, unknown>, storedVersion) }
      }
    }

    // Bilinmeyen anahtarlari at, eksikleri varsayilandan tamamla.
    this.values = { ...this.defaults }
    for (const key of Object.keys(this.defaults) as Array<keyof T>) {
      if (stored[key] !== undefined) this.values[key] = stored[key] as T[keyof T]
    }

    return this.values
  }

  all(): Readonly<T> {
    return this.values
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.values[key]
  }

  /** Bir veya birden fazla ayari gunceller ve degisiklikleri yayinlar. */
  set(patch: Partial<T>): void {
    const changed: Array<keyof T> = []
    for (const key of Object.keys(patch) as Array<keyof T>) {
      const next = patch[key]
      if (next === undefined) continue
      if (this.values[key] !== next) {
        this.values[key] = next as T[keyof T]
        changed.push(key)
      }
    }
    if (changed.length === 0) return

    this.emit('change', this.values, changed)
    this.scheduleFlush()
  }

  /** Tum ayarlari fabrika degerlerine dondurur. */
  reset(): void {
    this.values = { ...this.defaults }
    this.emit('change', this.values, Object.keys(this.defaults) as Array<keyof T>)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, 200)
  }

  /** Bekleyen yazmayi hemen diske indirir (uygulama kapanirken cagirin). */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    // Ust uste gelen flush cagrilarini tek yazmaya indirge.
    if (this.pendingFlush) return this.pendingFlush

    const payload: Persisted<T> = { __version: this.version, values: this.values }
    this.pendingFlush = writeJson(this.filePath, payload).finally(() => {
      this.pendingFlush = null
    })
    return this.pendingFlush
  }
}
