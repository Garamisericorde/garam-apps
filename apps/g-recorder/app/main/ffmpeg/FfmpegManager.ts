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

/** Stable Windows build that ships both ffmpeg.exe and ffprobe.exe */
const DOWNLOAD_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

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

  /** Candidate ffmpeg.exe locations, most specific first */
  private candidates(): string[] {
    const bundled = app.isPackaged
      ? resolve(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
      : resolve(app.getAppPath(), 'resources', 'ffmpeg', 'ffmpeg.exe')

    return [bundled, join(binDir(), 'ffmpeg.exe'), 'ffmpeg'].filter(
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
          copyFileSync(found, join(dir, exe))
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
      this.emit()
      return this.getStatus()
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
