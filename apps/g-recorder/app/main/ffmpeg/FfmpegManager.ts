import { app, net } from 'electron'
import { spawn, execFile } from 'child_process'
import { join, resolve } from 'path'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs'
import type { Dirent } from 'fs'
import type { FfmpegStatus } from '../../shared/types'
import { binDir } from '../../shared/paths'
import { logger } from '../logging/logger'

/**
 * Windows build that ships both ffmpeg.exe and ffprobe.exe.
 *
 * PINNED ON PURPOSE — do not "update" this to a rolling `latest` URL.
 *
 * FFmpeg's NVENC support is a compile-time contract: a build carries the NVIDIA
 * Video Codec SDK headers it was built against and refuses to run on a driver
 * older than those. Recent builds require API 13.1 (driver 570+), so tracking
 * the newest release silently locked out every machine on an older driver —
 * hardware perfectly capable of GPU encoding — and dropped it to encoding on
 * the CPU, which is what made games stutter with the buffer on.
 *
 * 7.1 requires API 12.x, covering drivers back to ~551 and GPUs back to Pascal.
 * Nothing this app uses needs anything newer. Verified against a 3060 Ti on a
 * driver reporting API 12.2: NVENC works, and so does handing ddagrab's D3D11
 * frames straight to it — 0.45 s of CPU for five seconds of 1440p60.
 *
 * The host matters as much as the version. This must point at a *permanently
 * archived, version-tagged* release: BtbN's dated auto-builds were the obvious
 * choice and turned out to be deleted within days, leaving the download button
 * returning 404. GyanD/codexffmpeg keeps its version tags indefinitely.
 *
 * Before changing this, check two things: that the URL belongs to a permanent
 * tag rather than a rolling build, and that the new build's NVENC still
 * initialises on an older driver — `EncoderDetect` reports the requirement in
 * its probe reason.
 */
const DOWNLOAD_URL =
  'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip'

const VERSION_PROBE_TIMEOUT_MS = 8_000

/**
 * Locates a usable FFmpeg installation and, when none exists, downloads one
 * into %APPDATA%/g-recorder/bin.
 *
 * Lookup order:
 *   1. Bundled with the app   (resources/ffmpeg/ffmpeg.exe)
 *   2. Previously downloaded  (userData/bin/ffmpeg.exe)
 *   3. Whatever is on PATH
 */
export class FfmpegManager {
  private static instance: FfmpegManager

  private _ffmpegPath: string | null = null
  private _ffprobePath: string | null = null
  private _version: string | null = null
  private _downloading = false
  private _downloadPercent = 0
  private _error: string | null = null
  private _onStatusChange: ((status: FfmpegStatus) => void) | null = null

  private constructor() {}

  static getInstance(): FfmpegManager {
    if (!FfmpegManager.instance) FfmpegManager.instance = new FfmpegManager()
    return FfmpegManager.instance
  }

  onStatusChange(handler: (status: FfmpegStatus) => void): void {
    this._onStatusChange = handler
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus(): FfmpegStatus {
    if (this._downloading) {
      return {
        state: 'downloading',
        path: null,
        version: null,
        downloadPercent: this._downloadPercent,
        error: null,
      }
    }
    if (this._ffmpegPath) {
      return {
        state: 'ready',
        path: this._ffmpegPath,
        version: this._version,
        downloadPercent: 100,
        error: null,
      }
    }
    return {
      state: this._error ? 'error' : 'missing',
      path: null,
      version: null,
      downloadPercent: 0,
      error: this._error,
    }
  }

  private emit(): void {
    this._onStatusChange?.(this.getStatus())
  }

  // ── Resolution ─────────────────────────────────────────────────────────────

  /**
   * Find a working FFmpeg and verify it by running `-version`.
   * Safe to call repeatedly — the result is cached once a binary works.
   */
  async ensureReady(): Promise<FfmpegStatus> {
    if (this._ffmpegPath) return this.getStatus()

    for (const candidate of this.candidates()) {
      const version = await probeVersion(candidate)
      if (version) {
        this._ffmpegPath = candidate
        this._ffprobePath = siblingFfprobe(candidate)
        this._version = version
        this._error = null
        logger.info('FFmpeg ready', { path: candidate, version })
        this.emit()
        return this.getStatus()
      }
    }

    logger.warn('No usable FFmpeg found')
    this.emit()
    return this.getStatus()
  }

  /**
   * Candidate ffmpeg.exe locations, most specific first.
   *
   * A build in binDir got there because the app downloaded it, which now
   * includes the user asking for the compatible one after a driver mismatch —
   * so it has to outrank whatever shipped with the app, or reinstalling would
   * silently change nothing.
   */
  private candidates(): string[] {
    const bundled = app.isPackaged
      ? resolve(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
      : resolve(app.getAppPath(), 'resources', 'ffmpeg', 'ffmpeg.exe')

    return [join(binDir(), 'ffmpeg.exe'), bundled, 'ffmpeg'].filter(
      (p) => p === 'ffmpeg' || existsSync(p),
    )
  }

  /** Resolved ffmpeg.exe path. Throws with a friendly message when unavailable. */
  get path(): string {
    if (!this._ffmpegPath) {
      throw new Error(
        'FFmpeg is not installed. Open Settings and click "Download FFmpeg" to set it up.',
      )
    }
    return this._ffmpegPath
  }

  /** Resolved ffprobe.exe path, falling back to PATH lookup */
  get probePath(): string {
    return this._ffprobePath ?? 'ffprobe'
  }

  get isReady(): boolean {
    return this._ffmpegPath !== null
  }

  // ── Download ───────────────────────────────────────────────────────────────

  /**
   * Download a Windows FFmpeg build and extract ffmpeg.exe + ffprobe.exe into
   * userData/bin. Resolves with the resulting status.
   */
  async download(): Promise<FfmpegStatus> {
    if (this._downloading || this._ffmpegPath) return this.getStatus()
    return this.install()
  }

  /**
   * Replace an FFmpeg that is already installed with the pinned build.
   *
   * `download()` deliberately refuses once a binary works, which is right for
   * first-run setup and wrong here: a machine that fell back to CPU encoding
   * because its FFmpeg demands a newer NVIDIA driver has a *working* FFmpeg,
   * just not one it can use the GPU with. Replacing it is the fix.
   */
  async reinstall(): Promise<FfmpegStatus> {
    if (this._downloading) return this.getStatus()

    logger.info('FFmpeg reinstall requested', { previous: this._ffmpegPath })
    this._ffmpegPath = null
    this._ffprobePath = null
    this._version = null
    return this.install()
  }

  private async install(): Promise<FfmpegStatus> {

    this._downloading = true
    this._downloadPercent = 0
    this._error = null
    this.emit()

    const dir = binDir()
    const zipPath = join(dir, 'ffmpeg-download.zip')
    const extractDir = join(dir, 'extract')

    try {
      mkdirSync(dir, { recursive: true })
      rmSync(extractDir, { recursive: true, force: true })

      logger.info('FFmpeg download starting', { url: DOWNLOAD_URL })
      await this.fetchToFile(DOWNLOAD_URL, zipPath)

      logger.info('FFmpeg download complete, extracting', { bytes: statSync(zipPath).size })
      await expandArchive(zipPath, extractDir)

      let copied = 0
      for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
        const found = findFile(extractDir, exe)
        if (found) {
          await copyOverLocked(found, join(dir, exe))
          copied++
        }
      }
      if (copied === 0) throw new Error('Archive did not contain ffmpeg.exe')

      this.cleanupDownload(zipPath, extractDir)

      this._downloading = false
      const status = await this.ensureReady()
      if (status.state !== 'ready') throw new Error('Downloaded FFmpeg could not be verified')

      logger.info('FFmpeg installed', { path: status.path })
      return status
    } catch (err) {
      this._downloading = false
      this._error = err instanceof Error ? err.message : String(err)
      logger.error('FFmpeg download failed', this._error)
      this.cleanupDownload(zipPath, extractDir)

      // A reinstall clears the resolved path before it starts, so a failure
      // here would leave the app believing it has no FFmpeg at all — when the
      // perfectly good previous binary is still sitting there. Find it again.
      const recovered = await this.ensureReady()
      if (recovered.state === 'ready') {
        logger.info('FFmpeg install failed; kept the existing binary', { path: recovered.path })
        // ensureReady clears _error on success, but the failure is still the
        // thing the user asked about and needs to see.
        this._error = err instanceof Error ? err.message : String(err)
      }

      this.emit()
      return { ...this.getStatus(), error: this._error }
    }
  }

  private cleanupDownload(zipPath: string, extractDir: string): void {
    rmSync(zipPath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }

  /** Stream a URL to disk, reporting progress as it goes */
  private fetchToFile(url: string, destination: string): Promise<void> {
    return new Promise((resolveDownload, rejectDownload) => {
      const request = net.request({ url, redirect: 'follow' })
      let settled = false

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        rejectDownload(err)
      }

      request.on('response', (response) => {
        if (response.statusCode >= 400) {
          // Name the URL: a 404 here means the pinned build moved or was
          // pruned, and without the address that is a guessing game.
          logger.error('FFmpeg download rejected', { url, status: response.statusCode })
          fail(new Error(`Download failed with HTTP ${response.statusCode}`))
          return
        }

        const header = response.headers['content-length']
        const total = Number(Array.isArray(header) ? header[0] : header) || 0
        let received = 0
        let lastPercent = -1

        const file = createWriteStream(destination)
        file.on('error', fail)

        response.on('data', (chunk: Buffer) => {
          received += chunk.length
          file.write(chunk)
          if (total <= 0) return
          // Throttle IPC chatter to whole-percent changes
          const percent = Math.min(Math.round((received / total) * 100), 99)
          if (percent !== lastPercent) {
            lastPercent = percent
            this._downloadPercent = percent
            this.emit()
          }
        })

        response.on('end', () => {
          file.end(() => {
            if (settled) return
            settled = true
            resolveDownload()
          })
        })

        response.on('error', fail)
      })

      request.on('error', fail)
      request.end()
    })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Copy over a file Windows may still consider in use.
 *
 * Callers stop the recorder before replacing FFmpeg, but the handle is not
 * always released the instant the process exits, and an export or a probe may
 * still be winding down. Retrying briefly turns a hard EBUSY failure into a
 * short wait; anything that outlasts it is a genuine lock worth reporting.
 */
async function copyOverLocked(source: string, destination: string): Promise<void> {
  const attempts = 10
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      copyFileSync(source, destination)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if ((code !== 'EBUSY' && code !== 'EPERM') || attempt === attempts) throw err
      logger.debug(`FFmpeg binary still locked, retrying (${attempt}/${attempts})`)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
    }
  }
}

/** Run `<binary> -version` and return the first output line, or null on failure */
function probeVersion(binary: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const proc = spawn(binary, ['-version'], { windowsHide: true })
    let stdout = ''
    let done = false

    const finish = (value: string | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolvePromise(value)
    }

    const timer = setTimeout(() => {
      proc.kill()
      finish(null)
    }, VERSION_PROBE_TIMEOUT_MS)

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.resume()
    proc.on('error', () => finish(null))
    proc.on('close', (code) => {
      if (code !== 0) return finish(null)
      finish(stdout.split('\n')[0]?.trim() || 'ffmpeg')
    })
  })
}

/** ffprobe.exe sitting next to a given ffmpeg.exe, if it exists */
function siblingFfprobe(ffmpegPath: string): string | null {
  if (ffmpegPath === 'ffmpeg') return 'ffprobe'
  const candidate = ffmpegPath.replace(/ffmpeg\.exe$/i, 'ffprobe.exe')
  return existsSync(candidate) ? candidate : null
}

/** Extract a zip using the PowerShell that ships with Windows (no npm dependency) */
function expandArchive(zipPath: string, destination: string): Promise<void> {
  const command = `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destination)} -Force`

  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (err) =>
        err ? rejectPromise(new Error(`Could not extract archive: ${err.message}`)) : resolvePromise(),
    )
  })
}

/** Single-quote a string for PowerShell (doubling embedded quotes) */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Depth-first search for a filename inside a directory tree */
function findFile(root: string, filename: string): string | null {
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      const hit = findFile(full, filename)
      if (hit) return hit
    } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
      return full
    }
  }
  return null
}
