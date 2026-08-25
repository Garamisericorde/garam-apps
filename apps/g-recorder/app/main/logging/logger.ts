import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, appendFileSync } from 'fs'

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return join(logsDir(), `g-recorder-${date}.log`)
}

function write(level: LogLevel, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString()
  const metaStr = meta !== undefined ? ' ' + JSON.stringify(meta) : ''
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`

  // Always print to console
  if (level === 'error') {
    console.error(line.trim())
  } else {
    console.log(line.trim())
  }

  // Write to file, best-effort
  try {
    mkdirSync(logsDir(), { recursive: true })
    appendFileSync(logFilePath(), line, 'utf8')
  } catch {
    // If we can't write logs, silently continue
  }
}

export const logger = {
  info: (msg: string, meta?: unknown) => write('info', msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', msg, meta),
  error: (msg: string, meta?: unknown) => write('error', msg, meta),
  debug: (msg: string, meta?: unknown) => write('debug', msg, meta),
}
