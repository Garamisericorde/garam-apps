import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
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
import { logger } from '../logging/logger'
import { FfmpegManager } from './FfmpegManager'
import { SettingsStore } from '../settings/SettingsStore'
import { listAudioDevices, pickDefaultLoopback, pickDefaultMic } from './AudioDevices'
import {
  buildCaptureArgs,
  buildSegmentOutputArgs,
  buildSingleFileOutputArgs,
} from './commands'
import { detectEncoders, resolveEncoder } from './EncoderDetect'
import { PRUNE_BUFFER_SEGMENTS } from '../settings/defaults'

/** How often the segment list is re-read (ms) */
const POLL_INTERVAL_MS = 1_000

/** How long to wait for FFmpeg to exit gracefully before killing it (ms) */
const STOP_TIMEOUT_MS = 5_000

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
      const settings = SettingsStore.getInstance().get()
      const { ffmpegPath, args: captureArgs } = await this.prepareCapture(settings)

      mkdirSync(cacheDir(), { recursive: true })
      this.loadIndex()
      // A fresh session writes a fresh list; previous timings live in the index
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
      this._process = this.spawnCapture(ffmpegPath, args, 'replay-buffer', () => {
        if (this._status.isRecording) {
          this.emit({ isRecording: false, error: 'Screen capture stopped unexpectedly' })
        }
        this.stopPolling()
      })

      this.startPolling(settings)
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

  async stop(): Promise<void> {
    if (!this._status.isRecording && !this._process) return
    if (this._stopping) return

    this._stopping = true
    try {
      logger.info('RecorderService: stopping replay buffer…')
      this.stopPolling()
      this.emit({ isRecording: false })

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
  ): Promise<{ ffmpegPath: string; args: string[] }> {
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

    logger.info('RecorderService: capture configuration', {
      capture: caps.hasDdagrab ? 'ddagrab' : 'gdigrab',
      encoder,
      zeroCopy: caps.hasCudaZeroCopy,
      monitorIndex: settings.monitorIndex,
      systemAudioDevice,
      micDevice,
    })

    const args = buildCaptureArgs({
      settings,
      encoder,
      useDdagrab: caps.hasDdagrab,
      useCudaZeroCopy: caps.hasCudaZeroCopy && encoder === 'nvenc',
      systemAudioDevice,
      micDevice,
    })

    return { ffmpegPath, args }
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

      if (!systemAudioDevice && noLoopbackFound) {
        logger.warn(
          'System audio is enabled but no loopback device was found. ' +
            'Enable "Stereo Mix" in Windows sound settings or install a virtual audio cable.',
        )
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
      stdio: ['pipe', 'ignore', 'pipe'],
    })

    attachStderrLog(proc, label, ffmpegPath, args)

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

  // ── Segment tracking ───────────────────────────────────────────────────────

  private startPolling(settings: AppSettings): void {
    this.stopPolling()
    this._pollTimer = setInterval(() => {
      try {
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
