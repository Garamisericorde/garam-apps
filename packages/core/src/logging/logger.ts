import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface LoggerOptions {
  /** Bu seviyenin altindakiler yazilmaz. Varsayilan: dev'de debug, uretimde info. */
  level?: LogLevel
  /** Saklanacak gunluk dosyasi sayisi. Varsayilan: 5 */
  keepFiles?: number
}

/**
 * %APPDATA%/<uygulama>/logs/ altina gunluk yazar ve ayni anda konsola basar.
 *
 * Her uygulama acilisinda yeni bir dosya acilir; eski dosyalar `keepFiles`
 * sayisini asinca silinir.
 */
export class Logger {
  private readonly dir: string
  private readonly minLevel: number
  private stream: WriteStream | null = null

  constructor(options: LoggerOptions = {}) {
    this.dir = join(app.getPath('userData'), 'logs')
    const fallback: LogLevel = app.isPackaged ? 'info' : 'debug'
    this.minLevel = LEVEL_ORDER[options.level ?? fallback]

    try {
      mkdirSync(this.dir, { recursive: true })
      this.rotate(options.keepFiles ?? 5)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      this.stream = createWriteStream(join(this.dir, `${stamp}.log`), { flags: 'a' })
    } catch (err) {
      // Gunluk yazamamak uygulamayi durdurmamali.
      console.error('[logger] gunluk dosyasi acilamadi:', err)
    }
  }

  get directory(): string {
    return this.dir
  }

  /** Gunluk klasorunu dosya gezgininde acar (Ayarlar > "Kayitlari ac"). */
  openDirectory(): void {
    void shell.openPath(this.dir)
  }

  debug(msg: string, ...rest: unknown[]): void {
    this.write('debug', msg, rest)
  }

  info(msg: string, ...rest: unknown[]): void {
    this.write('info', msg, rest)
  }

  warn(msg: string, ...rest: unknown[]): void {
    this.write('warn', msg, rest)
  }

  error(msg: string, ...rest: unknown[]): void {
    this.write('error', msg, rest)
  }

  private write(level: LogLevel, msg: string, rest: unknown[]): void {
    if (LEVEL_ORDER[level] < this.minLevel) return

    const extra = rest.length ? ' ' + rest.map((r) => formatValue(r)).join(' ') : ''
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}${extra}`

    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    consoleFn(line)
    this.stream?.write(line + '\n')
  }

  private rotate(keep: number): void {
    try {
      const files = readdirSync(this.dir)
        .filter((f) => f.endsWith('.log'))
        .map((f) => ({ f, mtime: statSync(join(this.dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)

      for (const old of files.slice(Math.max(0, keep - 1))) {
        unlinkSync(join(this.dir, old.f))
      }
    } catch {
      // Temizlik basarisiz olursa onemli degil.
    }
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.stream) return resolve()
      this.stream.end(resolve)
    })
    this.stream = null
  }
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}
