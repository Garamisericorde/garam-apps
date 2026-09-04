import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface LoggerOptions {
  /** Entries below this level are dropped. Default: debug in dev, info in production. */
  level?: LogLevel
  /** How many log files to keep. Default: 5 */
  keepFiles?: number
}

/**
 * Writes logs under %APPDATA%/<app>/logs/ and mirrors them to the console.
 *
 * A fresh file is opened on every launch; older files are pruned once they
 * exceed `keepFiles`.
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
      // Failing to open a log file must never take the app down.
      console.error('[logger] could not open log file:', err)
    }
  }

  get directory(): string {
    return this.dir
  }

  /** Opens the log folder in Explorer (Settings > "Open logs"). */
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
      // Rotation is best-effort; failing to prune old logs is harmless.
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
