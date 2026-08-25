// Generates the tray and installer icons from code, so the repo does not need
// binary art assets checked in. Run with: npm run icons
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icons')

const ACCENT = [0x6c, 0x63, 0xff]
const RECORD_RED = [0xff, 0x40, 0x40]
const IDLE_GREY = [0xc8, 0xc8, 0xd4]
const WHITE = [0xff, 0xff, 0xff]

// ── PNG encoding ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))

  return Buffer.concat([length, body, crc])
}

/** Encode RGBA pixel data as a PNG buffer */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // Each scanline is prefixed with filter type 0 (none)
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function createCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) }
}

function blend(canvas, x, y, [r, g, b], alpha) {
  if (alpha <= 0) return
  const i = (y * canvas.size + x) * 4
  const existing = canvas.data[i + 3] / 255
  const out = alpha + existing * (1 - alpha)

  canvas.data[i] = Math.round((r * alpha + canvas.data[i] * existing * (1 - alpha)) / out)
  canvas.data[i + 1] = Math.round((g * alpha + canvas.data[i + 1] * existing * (1 - alpha)) / out)
  canvas.data[i + 2] = Math.round((b * alpha + canvas.data[i + 2] * existing * (1 - alpha)) / out)
  canvas.data[i + 3] = Math.round(out * 255)
}

/** Signed distance from a point to a rounded rectangle, for anti-aliased edges */
function roundedRectDistance(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius)
  const dy = Math.abs(py - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

function fillRoundedRect(canvas, colour, inset, radiusRatio) {
  const { size } = canvas
  const centre = size / 2
  const half = centre - inset
  const radius = half * radiusRatio

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = roundedRectDistance(x + 0.5, y + 0.5, centre, centre, half, half, radius)
      blend(canvas, x, y, colour, coverage(distance))
    }
  }
}

function fillCircle(canvas, colour, radius) {
  const { size } = canvas
  const centre = size / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) - radius
      blend(canvas, x, y, colour, coverage(distance))
    }
  }
}

/** Convert a signed distance to an alpha value, giving a 1px soft edge */
function coverage(distance) {
  return Math.min(Math.max(0.5 - distance, 0), 1)
}

// ── Icon variants ────────────────────────────────────────────────────────────

/** App icon: accent rounded square with a white record dot */
function appIcon(size) {
  const canvas = createCanvas(size)
  fillRoundedRect(canvas, ACCENT, size * 0.06, 0.28)
  fillCircle(canvas, WHITE, size * 0.24)
  return canvas
}

/** Tray icon: just the dot, coloured by state */
function trayIcon(size, colour) {
  const canvas = createCanvas(size)
  fillCircle(canvas, colour, size * 0.36)
  return canvas
}

// ── ICO container ────────────────────────────────────────────────────────────

/** Wrap PNG buffers in an .ico container (Vista+ supports PNG-compressed entries) */
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length

  images.forEach(({ size, png }, index) => {
    const entry = index * 16
    directory[entry] = size >= 256 ? 0 : size
    directory[entry + 1] = size >= 256 ? 0 : size
    directory[entry + 2] = 0 // palette size
    directory[entry + 3] = 0 // reserved
    directory.writeUInt16LE(1, entry + 4) // colour planes
    directory.writeUInt16LE(32, entry + 6) // bits per pixel
    directory.writeUInt32BE(0, entry + 8)
    directory.writeUInt32LE(png.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })

  return Buffer.concat([header, directory, ...images.map((i) => i.png)])
}

// ── Entry point ──────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true })

const write = (name, buffer) => {
  writeFileSync(join(OUT_DIR, name), buffer)
  console.log(`  ${name} (${buffer.length} bytes)`)
}

console.log('Generating icons in resources/icons:')

for (const size of [16, 32]) {
  write(`tray-idle-${size}.png`, encodePng(size, size, trayIcon(size, IDLE_GREY).data))
  write(`tray-recording-${size}.png`, encodePng(size, size, trayIcon(size, RECORD_RED).data))
}

write('icon.png', encodePng(512, 512, appIcon(512).data))

const icoSizes = [16, 32, 48, 64, 128, 256]
write(
  'icon.ico',
  encodeIco(icoSizes.map((size) => ({ size, png: encodePng(size, size, appIcon(size).data) }))),
)

console.log('Done.')
