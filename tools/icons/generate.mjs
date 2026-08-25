/**
 * Bagimliliksiz simge ureteci.
 *
 * Tum Garam uygulamalari icin ayni gorsel dilde (yuvarlak kose kare + aksan
 * rengi + basit beyaz sembol) PNG ve ICO uretir. Harici bir rasterizer yok;
 * 4x supersampling ile kendi cizimini yapiyor.
 *
 * Kullanim:
 *   import { buildIcons } from '../../tools/icons/generate.mjs'
 *   await buildIcons({ outDir, accent: '#e94560', glyph: 'crop' })
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'

const SS = 4 // supersampling faktoru

// ── PNG kodlama ────────────────────────────────────────────────────────────

function crc32(buf) {
  let c
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = c ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeData))
  return Buffer.concat([len, typeData, crc])
}

/** RGBA piksel dizisini (size*size*4) PNG buffer'ina cevirir. */
function encodePng(rgba, size) {
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filtre: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit derinligi
  ihdr[9] = 6 // renk tipi: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * PNG'leri ICO kabina paketler.
 * Vista+ ICO dosyalari PNG yukunu dogrudan tasiyabilir; BMP'ye cevirmeye gerek yok.
 */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // ayrilmis
  header.writeUInt16LE(1, 2) // tip: 1 = ICO
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length

  entries.forEach((entry, i) => {
    const p = i * 16
    // 256 piksel 0 olarak kodlanir
    dir[p] = entry.size >= 256 ? 0 : entry.size
    dir[p + 1] = entry.size >= 256 ? 0 : entry.size
    dir[p + 2] = 0 // palet rengi yok
    dir[p + 3] = 0
    dir.writeUInt16LE(1, p + 4) // renk duzlemi
    dir.writeUInt16LE(32, p + 6) // bit/piksel
    dir.writeUInt32LE(entry.png.length, p + 8)
    dir.writeUInt32LE(offset, p + 12)
    offset += entry.png.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

// ── Cizim ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** Yuvarlak kose kare icinde mi? (supersample uzayinda) */
function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y
  if (cx === x && cy === y) return true
  return Math.hypot(x - cx, y - cy) <= radius
}

/**
 * Sembol maskeleri. Her biri (x, y, s) alir — s ikon kenar uzunlugu
 * (supersample uzayinda) — ve o noktanin beyaz sembole ait olup olmadigini doner.
 */
const GLYPHS = {
  /** g-snap: kirpma koseleri (ekran alintisi secim cercevesi) */
  crop(x, y, s) {
    const t = s * 0.075 // cizgi kalinligi
    const m = s * 0.26 // kenar bosluğu
    const arm = s * 0.2 // kose kolu uzunlugu
    const lo = m
    const hi = s - m

    const inArm = (a, b, horizontal) => {
      if (horizontal) return Math.abs(y - b) <= t / 2 && x >= a && x <= a + arm
      return Math.abs(x - a) <= t / 2 && y >= b && y <= b + arm
    }

    return (
      inArm(lo, lo, true) ||
      inArm(lo, lo, false) ||
      (Math.abs(y - lo) <= t / 2 && x >= hi - arm && x <= hi) ||
      (Math.abs(x - hi) <= t / 2 && y >= lo && y <= lo + arm) ||
      (Math.abs(x - lo) <= t / 2 && y >= hi - arm && y <= hi) ||
      (Math.abs(y - hi) <= t / 2 && x >= lo && x <= lo + arm) ||
      (Math.abs(y - hi) <= t / 2 && x >= hi - arm && x <= hi) ||
      (Math.abs(x - hi) <= t / 2 && y >= hi - arm && y <= hi)
    )
  },

  /** g-recorder: kayit noktasi */
  record(x, y, s) {
    return Math.hypot(x - s / 2, y - s / 2) <= s * 0.2
  },

  /** g-note: yazi satirlari */
  note(x, y, s) {
    const t = s * 0.07
    const left = s * 0.28
    for (let i = 0; i < 3; i++) {
      const cy = s * 0.34 + i * s * 0.16
      const right = s * (i === 2 ? 0.58 : 0.72)
      if (Math.abs(y - cy) <= t / 2 && x >= left && x <= right) return true
    }
    return false
  },
}

/** Tek bir boyutta RGBA buffer uretir. */
function renderIcon(size, accentHex, glyphName) {
  const S = size * SS
  const accent = hexToRgb(accentHex)
  const glyph = GLYPHS[glyphName] ?? GLYPHS.crop

  const inset = S * 0.045
  const radius = S * 0.22
  const rgba = Buffer.alloc(size * size * 4)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0
      let fgHits = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px * SS + sx + 0.5
          const y = py * SS + sy + 0.5
          if (!insideRoundedRect(x, y, inset, inset, S - inset, S - inset, radius)) continue
          bgHits++
          if (glyph(x, y, S)) fgHits++
        }
      }

      const total = SS * SS
      const alpha = bgHits / total
      const fg = bgHits > 0 ? fgHits / bgHits : 0

      // Beyaz sembolu aksan zemin uzerine harmanla
      const i = (py * size + px) * 4
      rgba[i] = Math.round(accent[0] * (1 - fg) + 255 * fg)
      rgba[i + 1] = Math.round(accent[1] * (1 - fg) + 255 * fg)
      rgba[i + 2] = Math.round(accent[2] * (1 - fg) + 255 * fg)
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }

  return rgba
}

// ── Genel API ──────────────────────────────────────────────────────────────

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/**
 * `outDir` altina icon.png (256) ve icon.ico (cok boyutlu) yazar.
 * `tray: false` verilmezse ayrica tray.png (16) ve tray@2x.png (32) uretir.
 */
export async function buildIcons({ outDir, accent, glyph, tray = true }) {
  await fs.mkdir(outDir, { recursive: true })

  const pngFor = (size) => encodePng(renderIcon(size, accent, glyph), size)

  if (tray !== false) {
    await fs.writeFile(join(outDir, 'tray.png'), pngFor(16))
    await fs.writeFile(join(outDir, 'tray@2x.png'), pngFor(32))
  }
  await fs.writeFile(join(outDir, 'icon.png'), pngFor(256))

  const entries = ICO_SIZES.map((size) => ({ size, png: pngFor(size) }))
  await fs.writeFile(join(outDir, 'icon.ico'), encodeIco(entries))

  return {
    outDir,
    files: [...(tray !== false ? ['tray.png', 'tray@2x.png'] : []), 'icon.png', 'icon.ico'],
    icoSizes: ICO_SIZES,
  }
}
