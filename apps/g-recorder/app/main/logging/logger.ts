import { Logger } from '@garam/core'

/**
 * G-Recorder's logger, backed by the shared `@garam/core` Logger.
 *
 * The shape stays the same — `logger.info(msg, meta?)` — because it is called
 * from a couple of dozen places. What changed underneath: log files now rotate
 * per launch instead of growing per day, and writes go through the shared
 * implementation, so a fix there reaches every app.
 */
let instance: Logger | null = null

/** Created lazily: `app.getPath` is only valid once Electron is ready. */
function shared(): Logger {
  if (!instance) instance = new Logger()
  return instance
}

export const logger = {
  info: (msg: string, meta?: unknown) => emit('info', msg, meta),
  warn: (msg: string, meta?: unknown) => emit('warn', msg, meta),
  error: (msg: string, meta?: unknown) => emit('error', msg, meta),
  debug: (msg: string, meta?: unknown) => emit('debug', msg, meta),

  /** Opens the log folder in Explorer — used by the Settings page. */
  openDirectory: () => shared().openDirectory(),
  get directory(): string {
    return shared().directory
  },
}

function emit(level: 'info' | 'warn' | 'error' | 'debug', msg: string, meta?: unknown): void {
  if (meta === undefined) shared()[level](msg)
  else shared()[level](msg, meta)
}
