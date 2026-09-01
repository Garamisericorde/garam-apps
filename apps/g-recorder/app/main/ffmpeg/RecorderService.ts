import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { screen } from 'electron'
import { constants as osConstants, cpus, setPriority } from 'os'
import { basename, dirname, join } from 'path'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import type {
  AppSettings,
  EncoderType,
  RecorderStatus,
  SegmentIndex,
  SegmentInfo,
} from '../../shared/types'
import { cacheDir, concatListPath, logsDir, segmentIndexPath, segmentListPath } from '../../shared/paths'
import { broadcast } from '../ipc/broadcast'
import { logger } from '../logging/logger'
import { FfmpegManager } from './FfmpegManager'
import { SettingsStore } from '../settings/SettingsStore'
import { listAudioDevices, pickDefaultLoopback, pickDefaultMic } from './AudioDevices'
import {
  buildCaptureArgs,
  buildSegmentOutputArgs,
  buildSingleFileOutputArgs,
} from './commands'
import type { SystemAudioFormat } from '../audio/SystemAudioBridge'
import {
  canCaptureSystemAudio,
  pipeSystemAudioTo,
  startSystemAudio,
  stopSystemAudio,
} from '../audio/SystemAudioBridge'
import { detectEncoders, resolveEncoder } from './EncoderDetect'
import { PRUNE_BUFFER_SEGMENTS } from '../settings/defaults'
import { resolutionHeight } from '../../shared/presets'

/** How often the segment list is re-read (ms) */
const POLL_INTERVAL_MS = 1_000

/** How long to wait for FFmpeg to exit gracefully before killing it (ms) */
const STOP_TIMEOUT_MS = 5_000

/**
 * Share of the machine's cores software encoding may use.
 *
 * x264 defaults to a thread per core, so the buffer and the game end up
 * fighting over the same CPU. Half the cores still keeps up with 1080p60 on the
 * ultrafast preset and leaves the rest to the game.
 */
const SOFTWARE_ENCODER_CORE_SHARE = 0.5

/** Never leave software encoding with fewer threads than this */
const MIN_SOFTWARE_ENCODER_THREADS = 2

/** Worker-thread cap for software capture encoding on this machine */
function softwareEncoderThreads(): number {
  const cores = cpus().length || 4
  return Math.max(MIN_SOFTWARE_ENCODER_THREADS, Math.floor(cores * SOFTWARE_ENCODER_CORE_SHARE))
}

/** Nearest even integer — a real display mode is never an odd number of pixels */
function roundToEven(value: number): number {
  return Math.round(value / 2) * 2
}

/**
 * How long to wait before reconnecting after the capture drops out.
 *
 * DXGI hands the duplication back almost immediately, so the first retry is
 * fast — a long pause here is a hole in the replay buffer.
 */
const RESTART_BASE_DELAY_MS = 400

/** Ceiling for the backoff, so a persistent failure retries quietly */
const RESTART_MAX_DELAY_MS = 8_000

/** A capture that ran at least this long counts as healthy, resetting backoff */
const HEALTHY_RUN_MS = 10_000

/** Consecutive immediate failures before giving up and telling the user */
const MAX_RESTART_ATTEMPTS = 6

/**
 * FFmpeg exits that mean "the display went away", not "this configuration is
 * broken".
 *
 * `887a0026` is DXGI_ERROR_ACCESS_LOST, which Windows raises whenever it tears
 * down desktop duplication — a game taking the display fullscreen-exclusive, a
 * resolution or refresh-rate change, a UAC prompt, a GPU driver reset. Every
 * one of those is routine while gaming, which is exactly when the buffer is
 * supposed to be running.
 */
const RECOVERABLE_STDERR = /887a0026|access.?lost|AcquireNextFrame failed|device.?removed/i

/** How much of FFmpeg's stderr to keep in memory for diagnosing an exit */
const STDERR_TAIL_CHARS = 2_000

/** Enough to hold a partial progress report while the rest arrives */
const PROGRESS_BUFFER_CHARS = 4_000

/**
 * How long the frame counter may stand still before the capture is presumed
 * dead.
 *
 * FFmpeg pads its output to a constant frame rate, so `frame` keeps climbing
 * even while the screen is perfectly still — a counter that stops has lost its
 * input, not its subject. Waiting a few seconds keeps a scheduling hiccup from
 * being mistaken for a failure.
 */
const CAPTURE_STALL_MS = 4_000

/**
 * Grace given to a capture that has not reported anything yet.
 *
 * Starting FFmpeg means opening the encoder and claiming the desktop
 * duplication, and the latter can be slow when a previous instance has only
 * just let go of it. Holding a fresh process to the running-capture deadline
 * kills it before it can produce its first frame, and the restart it triggers
 * runs into exactly the same wall — a loop that never recovers.
 */
const CAPTURE_STARTUP_GRACE_MS = 15_000

/** Window the frame rate is averaged over, in microseconds of captured time */
const FPS_WINDOW_US = 1_000_000

/** Samples kept to find one a full window old (reports arrive ~2/second) */
const FPS_HISTORY_SAMPLES = 12

/** Segments written by the strftime pattern below */
const SEGMENT_RE = /^seg_\d{8}_\d{6}\.mp4$/
const SEGMENT_PATTERN = 'seg_%Y%m%d_%H%M%S.mp4'

export class RecorderService {
  private static instance: RecorderService

  private _process: ChildProcess | null = null
  private _pollTimer: ReturnType<typeof setInterval> | null = null
  private _knownSegments = new Map<string, SegmentInfo>()
  private _recordingStartedAt = 0
  private _starting = false
  private _stopping = false

  /** Pending reconnect after the capture dropped out, if any */
  private _restartTimer: ReturnType<typeof setTimeout> | null = null
  private _restartAttempts = 0
  private _processStartedAt = 0
  /** Tail of the capture's stderr, to tell a lost display from a bad config */
  private _stderrTail = ''
  /** When the capture last produced a new frame — see checkForStall */
  private _lastFrameAt = 0
  /** Whether the current capture has reported any progress at all yet */
  private _sawProgress = false

  /** Set while a replay is being written, to keep pruning off the used files */
  private _saveHolds = 0

  /** Manual (non-buffer) recording state */
  private _manualProcess: ChildProcess | null = null
  private _manualOutputPath: string | null = null
  private _bufferWasRunning = false

  private _status: RecorderStatus = {
    isRecording: false,
    isManualRecording: false,
    segmentCount: 0,
    bufferSeconds: 0,
    oldestSegmentTime: null,
    newestSegmentTime: null,
    captureFps: null,
    error: null,
  }
  private _statusListeners: ((status: RecorderStatus) => void)[] = []

  private constructor() {}

  static getInstance(): RecorderService {
    if (!RecorderService.instance) RecorderService.instance = new RecorderService()
    return RecorderService.instance
  }

  /** Subscribe to status updates. Several subsystems listen (IPC, tray). */
  onStatusChange(handler: (status: RecorderStatus) => void): void {
    this._statusListeners.push(handler)
  }

  getStatus(): RecorderStatus {
    return { ...this._status }
  }

  private emit(partial: Partial<RecorderStatus>): void {
    this._status = { ...this._status, ...partial }
    const snapshot = this.getStatus()

    for (const listener of this._statusListeners) {
      try {
        listener(snapshot)
      } catch (err) {
        logger.error('Recorder status listener threw', String(err))
      }
    }
  }

  // ── Replay buffer ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._status.isRecording || this._starting) {
      logger.warn('RecorderService: already recording or starting')
      return
    }
    if (this._status.isManualRecording) {
      throw new Error('Stop the manual recording before starting the replay buffer')
    }

    this._starting = true
    try {
      this._restartAttempts = 0
      await this.spawnBuffer(false)
      this.emit({ isRecording: true, error: null })
      logger.info('RecorderService: replay buffer started')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('RecorderService: failed to start', message)
      this.emit({ isRecording: false, error: message })
      throw err
    } finally {
      this._starting = false
    }
  }

  /**
   * Spawn the capture process that feeds the buffer.
   *
   * `resuming` distinguishes a reconnect from a fresh start: the segments
   * already in memory are still valid footage, and reloading the on-disk index
   * would drop whatever has not been flushed to it yet.
   */
  private async spawnBuffer(resuming: boolean): Promise<void> {
    const settings = SettingsStore.getInstance().get()
    const { ffmpegPath, args: captureArgs, systemAudioPiped } = await this.prepareCapture(settings)

    mkdirSync(cacheDir(), { recursive: true })
    if (resuming) this.saveIndex()
    else this.loadIndex()

    // Each run's segment list starts its offsets at zero, so the old one has to
    // go; the timings it described are already absolute in the index.
    rmSync(segmentListPath(), { force: true })

    const args = [
      ...captureArgs,
      ...buildSegmentOutputArgs(
        settings.segmentDurationSeconds,
        join(cacheDir(), SEGMENT_PATTERN),
        segmentListPath(),
      ),
    ]

    this._recordingStartedAt = Date.now()
    this._processStartedAt = Date.now()
    this._lastFrameAt = Date.now()
    this._sawProgress = false
    this._stderrTail = ''
    this._process = this.spawnCapture(ffmpegPath, args, 'replay-buffer', () =>
      this.handleBufferExit(),
    )
    if (systemAudioPiped) this.feedSystemAudio(this._process)

    this.startPolling(settings)
  }

  /**
   * Route the renderer's loopback PCM into this process's stdin.
   *
   * FFmpeg blocks on an input that stops producing, so a write failure — the
   * usual one being the process having just exited — must be swallowed rather
   * than thrown: the exit handler is already dealing with it.
   */
  private feedSystemAudio(proc: ChildProcess): void {
    const stdin = proc.stdin
    if (!stdin) return

    stdin.on('error', (err) => {
      logger.debug('RecorderService: system audio pipe closed', String(err))
    })

    pipeSystemAudioTo((chunk) => {
      if (stdin.writable) stdin.write(chunk)
    })
  }

  /**
   * Notice a capture that has stopped producing frames and restart it.
   *
   * Waiting for the process to exit is not enough. When a game takes the
   * display, ddagrab fails with DXGI_ERROR_ACCESS_LOST and the video input
   * dies — but FFmpeg stays alive as long as the audio pipe keeps feeding it,
   * so no exit ever arrives. The buffer then looks healthy while recording
   * nothing, which is precisely when the user believes it is capturing their
   * game. The frame counter standing still is the only honest signal.
   */
  private checkForStall(): void {
    if (!this._process || this._stopping || !this._status.isRecording) return
    if (this._restartTimer !== null) return

    const limit = this._sawProgress ? CAPTURE_STALL_MS : CAPTURE_STARTUP_GRACE_MS
    if (Date.now() - this._lastFrameAt < limit) return

    logger.warn('RecorderService: capture stalled, restarting', {
      startedProducing: this._sawProgress,
      stalledForMs: Date.now() - this._lastFrameAt,
      stderr: this._stderrTail.slice(-200),
    })

    // Killing it routes into the normal reconnect path rather than duplicating
    // the backoff and bookkeeping here.
    const proc = this._process
    this._lastFrameAt = Date.now()
    proc.kill()
  }

  /**
   * Decide what a dead capture process means and act on it.
   *
   * Losing the display is routine — it happens every time a game goes
   * fullscreen — so the buffer reconnects instead of switching itself off. Only
   * a capture that keeps dying immediately is treated as broken, because that
   * is a configuration problem no amount of retrying will fix.
   */
  private handleBufferExit(): void {
    this.stopPolling()
    this._process = null

    // A stop the user asked for is not a failure.
    if (this._stopping || !this._status.isRecording) return
    // A failed spawn raises both 'error' and 'close'; one reconnect covers both.
    if (this._restartTimer !== null) return

    const ranFor = Date.now() - this._processStartedAt
    if (ranFor >= HEALTHY_RUN_MS) this._restartAttempts = 0

    const recoverable = RECOVERABLE_STDERR.test(this._stderrTail)
    this._restartAttempts++

    if (this._restartAttempts > MAX_RESTART_ATTEMPTS) {
      logger.error('RecorderService: capture keeps failing, giving up', {
        attempts: this._restartAttempts,
        stderr: this._stderrTail.slice(-400),
      })
      this.emit({
        isRecording: false,
        error: 'Screen capture keeps stopping. Check the log for what FFmpeg reported.',
      })
      return
    }

    const delay = Math.min(
      RESTART_BASE_DELAY_MS * 2 ** (this._restartAttempts - 1),
      RESTART_MAX_DELAY_MS,
    )

    logger.warn('RecorderService: capture dropped out, reconnecting', {
      attempt: this._restartAttempts,
      delayMs: delay,
      ranForMs: ranFor,
      reason: recoverable ? 'display access lost' : 'unknown',
    })

    this._restartTimer = setTimeout(() => {
      this._restartTimer = null
      if (this._stopping || !this._status.isRecording) return

      void this.spawnBuffer(true).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('RecorderService: reconnect failed', message)
        // Hand the next attempt back to the same path rather than unwinding.
        this.handleBufferExit()
      })
    }, delay)
  }

  /** Cancel a pending reconnect — used when the user stops the buffer */
  private cancelRestart(): void {
    if (this._restartTimer !== null) {
      clearTimeout(this._restartTimer)
      this._restartTimer = null
    }
  }

  async stop(): Promise<void> {
    if (!this._status.isRecording && !this._process) return
    if (this._stopping) return

    this._stopping = true
    this.cancelRestart()
    stopSystemAudio()
    try {
      logger.info('RecorderService: stopping replay buffer…')
      this.stopPolling()
      this.emit({ isRecording: false, captureFps: null })

      const proc = this._process
      this._process = null
      if (proc) await gracefulStop(proc)

      // Give the final segment a chance to appear in the list
      this.refreshSegments(SettingsStore.getInstance().get())
      logger.info('RecorderService: replay buffer stopped')
    } finally {
      this._stopping = false
    }
  }

  // ── Manual recording ───────────────────────────────────────────────────────

  /**
   * Record straight to a single file. The replay buffer is paused for the
   * duration so only one desktop capture runs at a time.
   */
  async startManualRecording(outputPath: string): Promise<void> {
    if (this._status.isManualRecording) throw new Error('A recording is already running')

    const settings = SettingsStore.getInstance().get()
    const { ffmpegPath, args: captureArgs } = await this.prepareCapture(settings)

    this._bufferWasRunning = this._status.isRecording
    if (this._bufferWasRunning) await this.stop()

    mkdirSync(dirname(outputPath), { recursive: true })
    const args = [...captureArgs, ...buildSingleFileOutputArgs(outputPath)]

    this._manualOutputPath = outputPath
    this._manualProcess = this.spawnCapture(ffmpegPath, args, 'manual-recording', () => {
      if (this._status.isManualRecording) {
        this.emit({ isManualRecording: false, error: 'Recording stopped unexpectedly' })
      }
    })

    this.emit({ isManualRecording: true, error: null })
    logger.info('RecorderService: manual recording started', { outputPath })
  }

  /** Stop the manual recording and return the finished file path */
  async stopManualRecording(): Promise<string | null> {
    const proc = this._manualProcess
    const outputPath = this._manualOutputPath

    this._manualProcess = null
    this._manualOutputPath = null
    this.emit({ isManualRecording: false })

    if (proc) await gracefulStop(proc)
    logger.info('RecorderService: manual recording stopped', { outputPath })

    if (this._bufferWasRunning) {
      this._bufferWasRunning = false
      await this.start().catch((err) =>
        logger.warn('Could not resume replay buffer', String(err)),
      )
    }

    return outputPath
  }

  // ── Replay selection ───────────────────────────────────────────────────────

  /**
   * Write a concat list covering the last `durationSeconds` of buffered footage
   * and return its path. Pruning is suspended until `releaseSaveHold` is called
   * so the listed files cannot be deleted mid-save.
   */
  async prepareReplayConcat(durationSeconds: number): Promise<{
    concatPath: string
    coveredSeconds: number
  }> {
    const settings = SettingsStore.getInstance().get()
    this.refreshSegments(settings)

    const cutoffMs = Date.now() - durationSeconds * 1000
    const selected = [...this._knownSegments.values()]
      .filter((s) => s.startTimestamp + s.durationSeconds * 1000 > cutoffMs)
      .filter((s) => existsSync(join(cacheDir(), s.filename)))
      .sort((a, b) => a.startTimestamp - b.startTimestamp)

    if (selected.length === 0) {
      throw new Error(
        this._status.isRecording
          ? 'The replay buffer is still filling up — try again in a few seconds'
          : 'Recording is not running, so there is nothing to save',
      )
    }

    const path = concatListPath()
    const lines = selected.map(
      (s) => `file '${join(cacheDir(), s.filename).replace(/\\/g, '/')}'`,
    )
    writeFileSync(path, lines.join('\n') + '\n', 'utf8')

    const coveredSeconds = selected.reduce((total, s) => total + s.durationSeconds, 0)
    logger.info('RecorderService: replay concat list written', {
      segments: selected.length,
      coveredSeconds,
    })

    return { concatPath: path, coveredSeconds }
  }

  /** Suspend cache pruning while a save is in flight */
  acquireSaveHold(): void {
    this._saveHolds++
  }

  releaseSaveHold(): void {
    this._saveHolds = Math.max(0, this._saveHolds - 1)
  }

  /** Delete every buffered segment (used by "Clear cache") */
  clearCache(): void {
    if (this._status.isRecording) throw new Error('Stop recording before clearing the cache')
    this._knownSegments.clear()
    for (const file of this.listSegmentFiles()) {
      rmSync(join(cacheDir(), file), { force: true })
    }
    rmSync(segmentIndexPath(), { force: true })
    rmSync(segmentListPath(), { force: true })
    this.emitSegmentStatus(SettingsStore.getInstance().get())
    logger.info('RecorderService: cache cleared')
  }

  /** Total size of the replay cache in bytes */
  cacheSizeBytes(): number {
    return this.listSegmentFiles().reduce((total, file) => {
      try {
        return total + statSync(join(cacheDir(), file)).size
      } catch {
        return total
      }
    }, 0)
  }

  // ── Capture setup ──────────────────────────────────────────────────────────

  /** Resolve FFmpeg, encoder, capture backend, and audio devices */
  private async prepareCapture(
    settings: AppSettings,
  ): Promise<{ ffmpegPath: string; args: string[]; systemAudioPiped: boolean }> {
    const manager = FfmpegManager.getInstance()
    const status = await manager.ensureReady()
    if (status.state !== 'ready') {
      throw new Error(
        'FFmpeg is not installed. Open Settings and click "Download FFmpeg" to set it up.',
      )
    }

    const ffmpegPath = manager.path
    const caps = await detectEncoders(ffmpegPath)
    const encoder: EncoderType = resolveEncoder(settings.encoder, caps)

    const { systemAudioDevice, micDevice } = await this.resolveAudioDevices(ffmpegPath, settings)

    // Chromium's loopback is the only way most machines have of hearing
    // themselves, so it is tried first and the DirectShow device is the
    // fallback — not the other way round.
    let systemAudioPipe: SystemAudioFormat | null = null
    if (settings.captureAudio && !systemAudioDevice && canCaptureSystemAudio()) {
      systemAudioPipe = await startSystemAudio()
      if (!systemAudioPipe) stopSystemAudio()
    }

    // The direct path cannot carry a filter, so it is only on the table when
    // the capture needs no scaling — either the user asked for source
    // resolution, or the display already is the requested height.
    const useD3d11Direct =
      caps.hasD3d11DirectNvenc && encoder === 'nvenc' && !this.needsScaling(settings)

    logger.info('RecorderService: capture configuration', {
      capture: caps.hasDdagrab ? 'ddagrab' : 'gdigrab',
      encoder,
      d3d11Direct: useD3d11Direct,
      zeroCopy: caps.hasCudaZeroCopy,
      monitorIndex: settings.monitorIndex,
      systemAudio: systemAudioPipe ? 'loopback (renderer)' : (systemAudioDevice ?? 'none'),
      micDevice,
    })

    if (!caps.hasDdagrab) {
      // gdigrab redraws the whole desktop through GDI on the CPU for every
      // frame, and it cannot see a fullscreen-exclusive game at all. Users hit
      // both at once — a stuttering game and a black recording — with nothing
      // on screen connecting the two.
      broadcast('app:notice', {
        level: 'warning',
        message:
          'Fast screen capture (ddagrab) is unavailable, so recording uses the slower GDI path. ' +
          'It costs noticeably more CPU and cannot record fullscreen-exclusive games — ' +
          'switch the game to borderless windowed mode.',
      })
    }

    const args = buildCaptureArgs({
      settings,
      encoder,
      useDdagrab: caps.hasDdagrab,
      useD3d11Direct,
      useCudaZeroCopy: caps.hasCudaZeroCopy && encoder === 'nvenc',
      systemAudioDevice,
      systemAudioPipe,
      micDevice,
      encoderThreads: softwareEncoderThreads(),
    })

    return { ffmpegPath, args, systemAudioPiped: systemAudioPipe !== null }
  }

  /**
   * Whether capture has to resize, which rules out every GPU-only path.
   *
   * Compared against the display's real pixel height, not its DIP height:
   * on fractional scaling those differ, and treating a 1080p display as
   * something else would give up the fast path for no reason. The size is
   * derived the way the rest of the family does it — bounds x scaleFactor,
   * rounded to an even number, because both dimensions of a real display mode
   * always are.
   */
  private needsScaling(settings: AppSettings): boolean {
    const target = resolutionHeight(settings.resolution)
    if (target === null) return false

    try {
      const displays = screen.getAllDisplays()
      const display = displays[settings.monitorIndex] ?? screen.getPrimaryDisplay()
      const nativeHeight = roundToEven(display.bounds.height * display.scaleFactor)
      return nativeHeight !== target
    } catch (err) {
      // Without a reliable size, assume scaling is needed: the slow path still
      // produces the resolution the user asked for, the fast one might not.
      logger.warn('RecorderService: could not read display size', String(err))
      return true
    }
  }

  /**
   * Turn the audio toggles into concrete DirectShow device names, falling back
   * to a sensible default when the user has not chosen one. Missing devices are
   * logged and skipped rather than failing the whole recording.
   */
  private async resolveAudioDevices(
    ffmpegPath: string,
    settings: AppSettings,
  ): Promise<{ systemAudioDevice: string | null; micDevice: string | null }> {
    if (!settings.captureAudio && !settings.captureMic) {
      return { systemAudioDevice: null, micDevice: null }
    }

    const { devices, noLoopbackFound } = await listAudioDevices(ffmpegPath)
    const exists = (name: string | null): boolean =>
      !!name && devices.some((d) => d.name === name)

    let systemAudioDevice: string | null = null
    if (settings.captureAudio) {
      systemAudioDevice = exists(settings.systemAudioDevice)
        ? settings.systemAudioDevice
        : pickDefaultLoopback(devices)

      // No DirectShow loopback device is the normal case, not a fault: the app
      // captures system audio through Chromium instead and needs nothing from
      // Windows. Only worth a word if that route is unavailable too, which is
      // the one situation where the recording really would come out silent.
      if (!systemAudioDevice && noLoopbackFound && !canCaptureSystemAudio()) {
        const message =
          'System audio is on, but it cannot be captured right now — the app window that ' +
          'records it is not available. Recording continues without system sound.'
        logger.warn(message)
        broadcast('app:notice', { level: 'warning', message })
      }
    }

    let micDevice: string | null = null
    if (settings.captureMic) {
      const candidate = exists(settings.micDevice) ? settings.micDevice : pickDefaultMic(devices)
      // Never open the same device twice — that would just duplicate the track
      micDevice = candidate === systemAudioDevice ? null : candidate
      if (!micDevice) logger.warn('Microphone capture is enabled but no device was found')
    }

    return { systemAudioDevice, micDevice }
  }

  private spawnCapture(
    ffmpegPath: string,
    args: string[],
    label: string,
    onUnexpectedExit: () => void,
  ): ChildProcess {
    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      // stdout carries the -progress stream the overlay's frame rate comes from
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.deprioritise(proc, label)
    attachStderrLog(proc, label, ffmpegPath, args)
    this.trackProgress(proc, SettingsStore.getInstance().get().fps)

    // Keep the last of stderr in memory as well as on disk: the exit handler
    // has to know *why* FFmpeg stopped, and re-reading the log file to find out
    // would race with the write stream still flushing it.
    proc.stderr?.on('data', (chunk: Buffer) => {
      this._stderrTail = (this._stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS)
    })

    proc.on('close', (code, signal) => {
      logger.info(`RecorderService: FFmpeg (${label}) exited`, { code, signal })
      onUnexpectedExit()
    })

    proc.on('error', (err) => {
      logger.error(`RecorderService: FFmpeg (${label}) spawn error`, String(err))
      this.emit({ error: `Could not start FFmpeg: ${err.message}` })
      onUnexpectedExit()
    })

    return proc
  }

  /**
   * Read FFmpeg's progress stream and turn it into a frame rate.
   *
   * The rate that matters is not `fps`, which desktop duplication pins to the
   * requested value by repeating the last frame, but how many frames were new.
   * `frame` minus `dup_frames`, differenced between two reports, is the rate the
   * screen is actually changing at — the number a player recognises, capped by
   * the configured capture rate.
   */
  private trackProgress(proc: ChildProcess, maxFps: number): void {
    if (!proc.stdout) return

    let buffered = ''
    /** Recent samples, oldest first, so the rate is measured over a window */
    const history: { frames: number; duplicates: number; micros: number }[] = []

    proc.stdout.on('data', (chunk: Buffer) => {
      buffered = (buffered + chunk.toString()).slice(-PROGRESS_BUFFER_CHARS)

      // Each report ends with a `progress=` line; anything earlier is partial.
      const blocks = buffered.split(/^progress=\w+$/m)
      if (blocks.length < 2) return
      buffered = blocks[blocks.length - 1] ?? ''

      const report = blocks[blocks.length - 2]
      if (!report) return

      const value = (key: string): number | null => {
        const match = new RegExp(`^${key}=\\s*(-?\\d+)`, 'm').exec(report)
        return match ? Number(match[1]) : null
      }

      const frames = value('frame')
      const micros = value('out_time_us')
      if (frames === null || micros === null) return
      const duplicates = value('dup_frames') ?? 0

      // Proof the capture is still alive; the stall watchdog reads this.
      const previous = history[history.length - 1]
      if (!previous || frames > previous.frames) {
        this._lastFrameAt = Date.now()
        this._sawProgress = true
      }

      history.push({ frames, duplicates, micros })
      if (history.length > FPS_HISTORY_SAMPLES) history.shift()

      /*
       * Measured against a sample about a second old rather than the previous
       * one. FFmpeg does not update `frame` and `dup_frames` at the same
       * instant, so consecutive reports disagree about which frames were new —
       * enough for the instantaneous rate to swing between a third of the real
       * value and the full capture rate, and occasionally to come out negative.
       * Over a second those disagreements cancel.
       */
      const oldest = history.find((sample) => micros - sample.micros >= FPS_WINDOW_US)
      if (!oldest) return

      const seconds = (micros - oldest.micros) / 1_000_000
      if (seconds <= 0) return

      const fresh = frames - oldest.frames - (duplicates - oldest.duplicates)
      // Cannot exceed the rate the screen is being sampled at, and cannot be
      // negative however the counters happen to land.
      const fps = Math.max(0, Math.min(maxFps, Math.round(fresh / seconds)))

      if (fps !== this._status.captureFps) this.emit({ captureFps: fps })
    })
  }

  /**
   * Drop the capture process below the game in Windows' scheduling order.
   *
   * At normal priority FFmpeg competes with the foreground game as an equal,
   * which is what the buffer being "on" felt like. Below-normal means it only
   * gets the time the game is not using — capture is never the thing that must
   * finish first.
   *
   * Best-effort: a failure here costs performance, not correctness, so it is
   * logged rather than raised.
   */
  private deprioritise(proc: ChildProcess, label: string): void {
    if (proc.pid === undefined) return
    try {
      setPriority(proc.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
    } catch (err) {
      logger.warn(`RecorderService: could not lower FFmpeg (${label}) priority`, String(err))
    }
  }

  // ── Segment tracking ───────────────────────────────────────────────────────

  private startPolling(settings: AppSettings): void {
    this.stopPolling()
    this._pollTimer = setInterval(() => {
      try {
        this.checkForStall()
        this.refreshSegments(settings)
        this.pruneSegments(settings)
        this.saveIndex()
        this.emitSegmentStatus(settings)
      } catch (err) {
        logger.error('RecorderService: poll error', String(err))
      }
    }, POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  /**
   * Read FFmpeg's own segment list. It records exact start/end offsets, which
   * beats inferring timings from file modification times.
   */
  private refreshSegments(settings: AppSettings): void {
    for (const entry of readSegmentList(segmentListPath())) {
      if (this._knownSegments.has(entry.filename)) continue
      if (!existsSync(join(cacheDir(), entry.filename))) continue

      this._knownSegments.set(entry.filename, {
        filename: entry.filename,
        startTimestamp: this._recordingStartedAt + entry.startSeconds * 1000,
        durationSeconds: Math.max(entry.endSeconds - entry.startSeconds, 0.01),
      })
    }

    this.adoptOrphanSegments(settings)
  }

  /**
   * Pick up segment files left by a previous session. Their exact offsets are
   * gone, so the file's mtime marks the end of the segment.
   */
  private adoptOrphanSegments(settings: AppSettings): void {
    for (const filename of this.listSegmentFiles()) {
      if (this._knownSegments.has(filename)) continue

      const path = join(cacheDir(), filename)
      let mtimeMs: number
      try {
        const stats = statSync(path)
        // Skip the file FFmpeg is still writing
        if (Date.now() - stats.mtimeMs < settings.segmentDurationSeconds * 1000) continue
        mtimeMs = stats.mtimeMs
      } catch {
        continue
      }

      this._knownSegments.set(filename, {
        filename,
        startTimestamp: mtimeMs - settings.segmentDurationSeconds * 1000,
        durationSeconds: settings.segmentDurationSeconds,
      })
    }
  }

  /** Drop segments that have aged out of the replay window */
  private pruneSegments(settings: AppSettings): void {
    if (this._saveHolds > 0) return // a save is reading these files right now

    const keepMs =
      (settings.replayLengthMinutes * 60 +
        settings.segmentDurationSeconds * PRUNE_BUFFER_SEGMENTS) *
      1000
    const cutoff = Date.now() - keepMs

    for (const [filename, info] of this._knownSegments) {
      if (info.startTimestamp + info.durationSeconds * 1000 >= cutoff) continue
      this._knownSegments.delete(filename)
      try {
        rmSync(join(cacheDir(), filename), { force: true })
      } catch (err) {
        logger.debug('Could not prune segment', { filename, error: String(err) })
      }
    }
  }

  private emitSegmentStatus(settings: AppSettings): void {
    const sorted = [...this._knownSegments.values()].sort(
      (a, b) => a.startTimestamp - b.startTimestamp,
    )
    const bufferSeconds = Math.min(
      sorted.reduce((total, s) => total + s.durationSeconds, 0),
      settings.replayLengthMinutes * 60,
    )

    this.emit({
      segmentCount: sorted.length,
      bufferSeconds,
      oldestSegmentTime: sorted[0]?.startTimestamp ?? null,
      newestSegmentTime: sorted[sorted.length - 1]?.startTimestamp ?? null,
    })
  }

  private listSegmentFiles(): string[] {
    try {
      return readdirSync(cacheDir())
        .filter((f) => SEGMENT_RE.test(f))
        .sort()
    } catch {
      return []
    }
  }

  // ── Index persistence ──────────────────────────────────────────────────────

  private loadIndex(): void {
    try {
      const path = segmentIndexPath()
      if (!existsSync(path)) return

      const raw = JSON.parse(readFileSync(path, 'utf8')) as SegmentIndex
      this._knownSegments.clear()
      for (const segment of raw.segments ?? []) {
        if (existsSync(join(cacheDir(), segment.filename))) {
          this._knownSegments.set(segment.filename, segment)
        }
      }
      logger.info('RecorderService: index loaded', { count: this._knownSegments.size })
    } catch (err) {
      logger.warn('RecorderService: could not load index', String(err))
    }
  }

  private saveIndex(): void {
    try {
      const index: SegmentIndex = {
        segments: [...this._knownSegments.values()].sort(
          (a, b) => a.startTimestamp - b.startTimestamp,
        ),
      }
      writeFileSync(segmentIndexPath(), JSON.stringify(index), 'utf8')
    } catch (err) {
      logger.warn('RecorderService: could not save index', String(err))
    }
  }
}

// ── Module helpers ───────────────────────────────────────────────────────────

interface SegmentListEntry {
  filename: string
  startSeconds: number
  endSeconds: number
}

/** Parse FFmpeg's CSV segment list: `<path>,<start>,<end>` per line */
export function parseSegmentList(csv: string): SegmentListEntry[] {
  const entries: SegmentListEntry[] = []

  for (const line of csv.split('\n')) {
    const parts = line.trim().split(',')
    if (parts.length < 3) continue

    const startSeconds = Number(parts[parts.length - 2])
    const endSeconds = Number(parts[parts.length - 1])
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) continue

    entries.push({
      filename: basename(parts.slice(0, parts.length - 2).join(',')),
      startSeconds,
      endSeconds,
    })
  }

  return entries
}

function readSegmentList(path: string): SegmentListEntry[] {
  try {
    return parseSegmentList(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

/** Ask FFmpeg to finish writing, then force it down if it ignores us */
function gracefulStop(proc: ChildProcess): Promise<void> {
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise()
    }

    const timer = setTimeout(() => {
      logger.warn('RecorderService: graceful shutdown timed out, killing FFmpeg')
      proc.kill()
      finish()
    }, STOP_TIMEOUT_MS)

    proc.on('close', finish)

    // 'q' on stdin is FFmpeg's clean-shutdown signal; it flushes the MP4 moov atom
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write('q\n', () => proc.stdin?.end())
    } else {
      proc.kill()
    }
  })
}

/** Pipe an FFmpeg process's stderr to a dated log file */
function attachStderrLog(
  proc: ChildProcess,
  label: string,
  ffmpegPath: string,
  args: string[],
): void {
  if (!proc.stderr) return

  try {
    mkdirSync(logsDir(), { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const stream = createWriteStream(join(logsDir(), `ffmpeg-${date}.log`), { flags: 'a' })

    stream.write(
      `\n=== ${label} started ${new Date().toISOString()} ===\n` +
        `Command: ${ffmpegPath} ${args.join(' ')}\n\n`,
    )
    proc.stderr.pipe(stream)
    proc.stderr.on('close', () => stream.end())
  } catch (err) {
    logger.warn('RecorderService: could not open FFmpeg log file', String(err))
  }
}
