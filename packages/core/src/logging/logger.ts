import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function isLogLevel(value: string | undefined): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
}

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
    // GARAM_LOG_LEVEL wins over everything.
    //
    // These apps write their most useful lines at debug — capture timings, heap
    // and external memory per capture, the size the display actually returned —
    // and a packaged build threw all of them away. So the one build where a
    // long-running fault appears was the one build that could not describe it,
    // and the only way to look was to compile a special copy. An environment
    // variable costs nothing and means a user can reproduce with the diagnostics
    // on.
    const override = process.env['GARAM_LOG_LEVEL']?.toLowerCase()
    const level = isLogLevel(override) ? override : (options.level ?? fallback)
    this.minLevel = LEVEL_ORDER[level]

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
