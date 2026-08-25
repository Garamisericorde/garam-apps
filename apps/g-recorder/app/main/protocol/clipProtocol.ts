import { protocol } from 'electron'
import { Readable } from 'stream'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname } from 'path'
import { logger } from '../logging/logger'

export const CLIP_SCHEME = 'clip'

/**
 * Files the renderer is allowed to stream. Only paths the main process has
 * handed out — saved replays, recordings, exports, and files the user picked in
 * a dialog — are ever readable, so the renderer cannot walk the filesystem.
 */
const allowedPaths = new Set<string>()

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.gif': 'image/gif',
}

/** Grant the renderer read access to a file and return its clip:// URL */
export function registerClipFile(filePath: string): string {
  allowedPaths.add(normalize(filePath))
  return toClipUrl(filePath)
}

export function isClipFileAllowed(filePath: string): boolean {
  return allowedPaths.has(normalize(filePath))
}

/** clip://local/<url-encoded absolute path> */
export function toClipUrl(filePath: string): string {
  return `${CLIP_SCHEME}://local/${encodeURIComponent(filePath)}`
}

/**
 * Must run before `app.whenReady()`. Marking the scheme as standard + secure
 * lets it satisfy a `media-src 'self'`-style CSP and support range requests,
 * which the <video> element needs in order to seek.
 */
export function registerClipScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CLIP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ])
}

/** Must run after `app.whenReady()` */
export function registerClipProtocolHandler(): void {
  protocol.handle(CLIP_SCHEME, async (request) => {
    try {
      return serve(request)
    } catch (err) {
      logger.error('clip:// request failed', String(err))
      return new Response('Internal error', { status: 500 })
    }
  })
  logger.info('clip:// protocol registered')
}

function serve(request: Request): Response {
  const filePath = decodeFilePath(request.url)

  if (!filePath || !isClipFileAllowed(filePath)) {
    logger.warn('clip:// denied', { url: request.url })
    return new Response('Forbidden', { status: 403 })
  }
  if (!existsSync(filePath)) {
    return new Response('Not found', { status: 404 })
  }

  const size = statSync(filePath).size
  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const range = parseRange(request.headers.get('range'), size)

  if (!range) {
    return new Response(toWebStream(createReadStream(filePath)), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    })
  }

  const { start, end } = range
  return new Response(toWebStream(createReadStream(filePath, { start, end })), {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  })
}

/** Extract the absolute path from a clip:// URL */
function decodeFilePath(url: string): string | null {
  try {
    const parsed = new URL(url)
    const encoded = parsed.pathname.replace(/^\//, '')
    return encoded ? decodeURIComponent(encoded) : null
  } catch {
    return null
  }
}

/** Parse a `Range: bytes=start-end` header into concrete offsets */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null

  const match = /bytes=(\d*)-(\d*)/.exec(header)
  if (!match) return null

  const [, rawStart, rawEnd] = match
  let start = rawStart ? Number(rawStart) : 0
  let end = rawEnd ? Number(rawEnd) : size - 1

  if (!rawStart && rawEnd) {
    // Suffix form: "bytes=-500" means the final 500 bytes
    start = Math.max(size - Number(rawEnd), 0)
    end = size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null

  start = Math.max(0, start)
  end = Math.min(end, size - 1)
  if (start > end) return null

  return { start, end }
}

function toWebStream(stream: ReturnType<typeof createReadStream>): ReadableStream {
  return Readable.toWeb(stream) as ReadableStream
}

function normalize(filePath: string): string {
  return filePath.replace(/\//g, '\\').toLowerCase()
}
