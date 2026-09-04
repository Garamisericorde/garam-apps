import { desktopCapturer, session } from 'electron'
import type { BrowserWindow } from 'electron'
import { logger } from '../logging/logger'

/**
 * System audio capture, routed through Chromium instead of FFmpeg.
 *
 * This is a deliberate exception to "all capture happens in FFmpeg". FFmpeg on
 * Windows has no WASAPI loopback: it can only reach system audio through a
 * DirectShow device, and machines without "Stereo Mix" — every USB headset,
 * which is most gaming setups — simply do not have one. Chromium does have
 * WASAPI loopback, so the renderer captures the desktop audio, turns it into
 * raw PCM and hands it back here to be piped into FFmpeg as an ordinary input.
 *
 * The renderer is therefore load-bearing while recording. That is why the
 * window is created with background throttling off, and why a capture that
 * never delivers a first chunk falls back to recording without system audio
 * rather than leaving FFmpeg blocked on an input that never arrives.
 */

export interface SystemAudioFormat {
  sampleRate: number
  channels: number
  /** FFmpeg's name for signed 16-bit little-endian PCM */
  codec: string
}

/**
 * What we ask the renderer for. Windows may hand back something else — loopback
 * delivers whatever the output device is mixing at — so the format FFmpeg is
 * told to expect is the one the renderer reports, never this one. A headerless
 * PCM stream carries no rate of its own; guessing wrong plays the recording
 * back at the wrong speed with nothing in the file to explain it.
 */
const REQUESTED_FORMAT: SystemAudioFormat = {
  sampleRate: 48_000,
  channels: 2,
  codec: 's16le',
}

/** How long to wait for the renderer's first chunk before giving up on it */
const FIRST_CHUNK_TIMEOUT_MS = 4_000

/**
 * How long to wait for the renderer to publish its capture entry point.
 *
 * The buffer can auto-start before the window has finished loading — how the
 * race lands depends on nothing more than whether the encoder probes hit their
 * cache. Losing it used to mean the recording silently had no system sound,
 * with only "script failed to execute" in the log to say why.
 */
const RENDERER_READY_TIMEOUT_MS = 8_000

type ChunkSink = (chunk: Buffer) => void

let _window: BrowserWindow | null = null
/** Screen to attach the loopback audio to, resolved before the request is made */
let _screenSource: Electron.DesktopCapturerSource | null = null
let _sink: ChunkSink | null = null
let _pending: Buffer[] = []
let _firstChunk: (() => void) | null = null
/** Format the renderer reported for the audio actually flowing */
let _format: SystemAudioFormat = REQUESTED_FORMAT

/**
 * Allow the renderer's getDisplayMedia call to receive desktop audio.
 *
 * Electron refuses display capture unless the app answers this request itself.
 * The video source is required — Chromium will not hand over loopback audio for
 * an audio-only request — but the renderer drops that track immediately.
 */
export function registerSystemAudioHandler(window: BrowserWindow): void {
  _window = window

  logger.info('SystemAudio: display-media handler registered')

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      // Answered synchronously on purpose. Enumerating screens takes ~550 ms,
      // and a callback that arrives that late has already had the request
      // cancelled out from under it — the renderer sees "the user aborted a
      // request" with nothing to explain it. The source is fetched before the
      // request is triggered instead; see startSystemAudio.
      logger.info('SystemAudio: display-media request received', { haveSource: !!_screenSource })

      if (!_screenSource) {
        callback({})
        return
      }
      callback({ video: _screenSource, audio: 'loopback' })
    },
    // Chromium would otherwise open its own picker, which a tray app must not do
    { useSystemPicker: false },
  )
}

/** Whether a renderer is available to capture with */
export function canCaptureSystemAudio(): boolean {
  return _window !== null && !_window.isDestroyed()
}

/**
 * Ask the renderer to start capturing, resolving once audio is actually
 * flowing. Chunks that arrive before the sink is attached are held, so the
 * start of the recording is not clipped.
 */
export async function startSystemAudio(): Promise<SystemAudioFormat | null> {
  if (!canCaptureSystemAudio()) {
    logger.warn('SystemAudio: no renderer available')
    return null
  }

  _pending = []
  _sink = null

  // Resolved up front so the request handler can answer without awaiting.
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    })
    _screenSource = sources[0] ?? null
  } catch (err) {
    logger.warn('SystemAudio: could not list screen sources', String(err))
    _screenSource = null
  }

  if (!_screenSource) {
    logger.warn('SystemAudio: no screen source to attach loopback audio to')
    return null
  }

  if (!(await waitForRendererEntry())) {
    logger.warn('SystemAudio: the renderer never became ready, continuing without system sound')
    return null
  }

  const flowing = new Promise<boolean>((resolvePromise) => {
    const timer = setTimeout(() => {
      _firstChunk = null
      logger.warn('SystemAudio: no audio arrived, continuing without system sound')
      resolvePromise(false)
    }, FIRST_CHUNK_TIMEOUT_MS)

    _firstChunk = () => {
      clearTimeout(timer)
      _firstChunk = null
      resolvePromise(true)
    }
  })

  // Not an IPC message: `getDisplayMedia` requires transient user activation,
  // and a recording that starts from a hotkey or at launch has none — Chromium
  // rejects it with "the user aborted a request". `executeJavaScript`'s second
  // argument is the only way to tell it the call is user-initiated.
  try {
    const result = (await _window?.webContents.executeJavaScript(
      `window.__gRecorderStartSystemAudio(${JSON.stringify(REQUESTED_FORMAT)})`,
      true,
    )) as { ok: boolean; error?: string; format?: SystemAudioFormat } | undefined

    if (!result?.ok) {
      logger.warn('SystemAudio: renderer could not start loopback capture', {
        error: result?.error ?? 'renderer returned nothing',
      })
      return null
    }

    _format = { ...REQUESTED_FORMAT, ...result.format }
    logger.info('SystemAudio: loopback capture started', _format)
  } catch (err) {
    logger.warn('SystemAudio: could not reach the renderer', String(err))
    return null
  }

  return (await flowing) ? _format : null
}

/**
 * Wait until the renderer has published `__gRecorderStartSystemAudio`.
 *
 * Polled rather than hung off 'did-finish-load', because that event has already
 * passed by the time a later recording starts, and the entry point is what
 * actually has to exist — a loaded page whose React tree has not mounted yet
 * would still fail.
 */
async function waitForRendererEntry(): Promise<boolean> {
  const deadline = Date.now() + RENDERER_READY_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (!canCaptureSystemAudio()) return false

    try {
      const ready = await _window?.webContents.executeJavaScript(
        `typeof window.__gRecorderStartSystemAudio === 'function'`,
      )
      if (ready === true) return true
    } catch {
      // Executing against a page that is still loading throws; that is the
      // case being waited out, not a failure.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }

  return false
}

/** Attach the destination for PCM, flushing anything captured while waiting */
export function pipeSystemAudioTo(sink: ChunkSink): void {
  _sink = sink
  for (const chunk of _pending) sink(chunk)
  _pending = []
}

export function stopSystemAudio(): void {
  _sink = null
  _pending = []
  _firstChunk = null
  if (canCaptureSystemAudio()) _window?.webContents.send('systemAudio:stop')
}

/** Called by the IPC layer for every PCM chunk the renderer sends */
export function receiveSystemAudioChunk(chunk: Buffer): void {
  _firstChunk?.()

  if (_sink) {
    _sink(chunk)
    return
  }

  // Hold at most a second of audio; beyond that the recording is not running
  // and the chunks are only a leak waiting to happen.
  const maxPending = _format.sampleRate * _format.channels * 2
  _pending.push(chunk)
  let held = _pending.reduce((sum, c) => sum + c.length, 0)
  while (held > maxPending && _pending.length > 1) {
    held -= _pending.shift()?.length ?? 0
  }
}
