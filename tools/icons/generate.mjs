/**
 * Dependency-free icon generator.
 *
 * Produces PNG and ICO files for every Garam app in one visual language:
 * a rounded square in the accent color with a simple white glyph. There is
 * no external rasterizer; it draws itself with 4x supersampling.
 *
 * Glyphs: `crop` (g-snap), `record` (g-recorder), `note` (g-note),
 * `node` (g-vector), `download` (Garam Setup).
 *
 * `accent` is either a flat hex string or a two-stop gradient
 * `{ from, to }`, which runs diagonally from the top-left corner.
 *
 * Usage:
 *   import { buildIcons } from '../../tools/icons/generate.mjs'
 *   await buildIcons({ outDir, accent: '#e94560', glyph: 'note' })
 *   await buildIcons({ outDir, accent: { from: '#2563eb', to: '#9333ea' }, glyph: 'crop' })
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'

const SS = 4 // supersampling factor

// ── PNG encoding ───────────────────────────────────────────────────────────

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

/** Turns an RGBA pixel array (size*size*4) into a PNG buffer. */
function encodePng(rgba, size) {
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
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
 * Packs the PNGs into an ICO container.
 * Vista+ ICO files can carry a PNG payload directly, so no BMP conversion.
 */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = ICO
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length

  entries.forEach((entry, i) => {
    const p = i * 16
    // 256 is encoded as 0
    dir[p] = entry.size >= 256 ? 0 : entry.size
    dir[p + 1] = entry.size >= 256 ? 0 : entry.size
    dir[p + 2] = 0 // no color palette
    dir[p + 3] = 0
    dir.writeUInt16LE(1, p + 4) // color planes
    dir.writeUInt16LE(32, p + 6) // bits per pixel
    dir.writeUInt32LE(entry.png.length, p + 8)
    dir.writeUInt32LE(offset, p + 12)
    offset += entry.png.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

// ── Drawing ────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/**
 * Turns either accent form into the pair the renderer works with.
 * A flat colour is simply a gradient that goes nowhere.
 */
function normalizeAccent(accent) {
  if (typeof accent === 'string') return { from: hexToRgb(accent), to: hexToRgb(accent) }
  return { from: hexToRgb(accent.from), to: hexToRgb(accent.to ?? accent.from) }
}

/**
 * Signed distance to the rounded square: negative inside, positive outside.
 *
 * A distance rather than a yes/no, because the rim light needs to know HOW FAR
 * inside the edge a pixel is, not just that it is.
 */
function roundedSquareDistance(x, y, cx, cy, half, radius) {
  const qx = Math.abs(x - cx) - (half - radius)
  const qy = Math.abs(y - cy) - (half - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

/**
 * The shared "G" every Garam app carries.
 *
 * Built analytically rather than from a font: no rasterizer is available here,
 * and a ring with a gap plus a crossbar reads as a G at every size down to 16px.
 */
function gMark(x, y, s, { radius = 0.27, weight = 0.085 } = {}) {
  const cx = s / 2
  const cy = s / 2
  const R = s * radius // outer radius of the ring
  const t = s * weight // stroke thickness
  const r = R - t

  const dx = x - cx
  const dy = y - cy
  const d = Math.hypot(dx, dy)

  // Ring, with the opening cut out of the upper right.
  // Screen y grows downward, so negative angles point up.
  const angle = Math.atan2(dy, dx)
  const inGap = angle > -1.15 && angle < -0.12
  if (d >= r && d <= R && !inGap) return true

  // Crossbar: from the centre out to the ring, at mid height.
  if (Math.abs(dy) <= t / 2 && dx >= -t * 0.2 && dx <= R) return true

  return false
}

/**
 * App-specific marks, drawn alongside the shared G.
 *
 * Each takes (x, y, s) in supersample space plus `small`, which is set for the
 * tray sizes. At 16px the secondary mark is two pixels of mush that only muddies
 * the G — measured by eye on a magnified render — so every glyph drops it there
 * and draws a bigger, heavier G instead. Detail that cannot resolve is not
 * detail, it is noise.
 *
 * Two rules, both learned by rendering it wrong first:
 *
 * 1. **Stay off the G.** Its ring reaches 0.27s from the centre, and every mark
 *    here once sat partly inside that: the record dot grew out of the G like a
 *    tumour, the note lines ran into its crossbar. Nothing reads as deliberate
 *    once it touches the letter. Marks live past ~0.30s, in the corner, and
 *    must also stay inside the plate — whose rounded corner cuts in hard at
 *    exactly the same place, so both ends need checking.
 * 2. **Be one solid silhouette.** 32px is the smallest size that still draws a
 *    mark, and the corner it lives in is about 6px across. Anything with
 *    internal structure at that size — a lens hole, a pair of hairlines, a
 *    bracket — comes out as grey mush. Detail may resolve at 48 and up; the
 *    shape has to work before it does.
 */
const GLYPHS = {
  /**
   * g-snap: the G inside four corner brackets — a selection frame.
   *
   * The one mark here that is not a small shape in the corner, because a
   * screenshot tool's symbol is the frame you drag, and a frame has to surround
   * something to be a frame.
   *
   * It shipped once and came back: the first version sat 0.155s from the edge
   * with 0.065s arms, which crowded the plate's own rounded corners and, at
   * 32px, left four two-pixel flecks that read as rendering dirt. Pulled in to
   * 0.185s and thickened to 0.078s — 2.5px at 32 rather than 2.1 — so each
   * corner survives as a corner. The brackets are still dropped below that,
   * where nothing this fine can resolve at all.
   */
  crop(x, y, s, small) {
    if (small) return gMark(x, y, s, { radius: 0.33, weight: 0.108 })
    if (gMark(x, y, s)) return true

    const t = s * 0.078 // bracket thickness
    const m = s * 0.168 // distance from the edge
    const arm = s * 0.145 // length of each corner arm
    const lo = m
    const hi = s - m

    const hBar = (edgeY, fromX, toX) =>
      Math.abs(y - edgeY) <= t / 2 && x >= fromX - t / 2 && x <= toX + t / 2
    const vBar = (edgeX, fromY, toY) =>
      Math.abs(x - edgeX) <= t / 2 && y >= fromY - t / 2 && y <= toY + t / 2

    return (
      // top-left
      hBar(lo, lo, lo + arm) ||
      vBar(lo, lo, lo + arm) ||
      // top-right
      hBar(lo, hi - arm, hi) ||
      vBar(hi, lo, lo + arm) ||
      // bottom-left
      hBar(hi, lo, lo + arm) ||
      vBar(lo, hi - arm, hi) ||
      // bottom-right
      hBar(hi, hi - arm, hi) ||
      vBar(hi, hi - arm, hi)
    )
  },

  /**
   * g-recorder: the G with a record dot at the lower right.
   *
   * The dot was centred at 0.735s with a radius of 0.105s, which put its inner
   * edge 0.227s from the centre — inside the G's ring. It read as a blister on
   * the letter rather than a record light. Slightly smaller, slightly further
   * out, and it separates.
   */
  record(x, y, s, small) {
    if (small) return gMark(x, y, s, { radius: 0.33, weight: 0.108 })
    if (gMark(x, y, s)) return true
    return Math.hypot(x - s * 0.79, y - s * 0.79) <= s * 0.095
  },

  /**
   * g-note: the G with text lines at the lower right.
   *
   * They used to start at 0.6s, which ran the top line straight into the G's
   * crossbar and made the letter look like it had a tail. Moved out and made
   * heavier; the ragged right edge is what says "text" rather than "equals".
   */
  note(x, y, s, small) {
    if (small) return gMark(x, y, s, { radius: 0.33, weight: 0.108 })
    if (gMark(x, y, s)) return true

    const t = s * 0.05
    const left = s * 0.7
    for (let i = 0; i < 2; i++) {
      const lineY = s * (i === 0 ? 0.76 : 0.855)
      const right = s * (i === 0 ? 0.895 : 0.82)
      if (Math.abs(y - lineY) <= t / 2 && x >= left && x <= right) return true
    }
    return false
  },

  /**
   * g-vector: the G with a bezier anchor at the lower right.
   *
   * A filled square with a short handle arm running off it — the mark you see a
   * thousand times an hour in a path editor. Drawn as a square rather than a
   * pen nib because a nib's taper is three pixels of grey at 32px, while a
   * square with a straight arm still reads as an anchor point.
   */
  node(x, y, s, small) {
    if (small) return gMark(x, y, s, { radius: 0.33, weight: 0.108 })
    if (gMark(x, y, s)) return true

    const cx = s * 0.79
    const cy = s * 0.79
    const half = s * 0.052

    // The anchor itself.
    if (Math.abs(x - cx) <= half && Math.abs(y - cy) <= half) return true

    // Its handle arm, up and to the right at 45 degrees, ending in a dot.
    const t = s * 0.032
    const along = (x - cx + (cy - y)) / Math.SQRT2 // distance along the arm
    const across = (x - cx - (cy - y)) / Math.SQRT2 // distance off the arm
    const reach = s * 0.13
    if (along >= half && along <= reach && Math.abs(across) <= t / 2) return true
    return Math.hypot(x - (cx + reach / Math.SQRT2), y - (cy - reach / Math.SQRT2)) <= s * 0.042
  },

  /**
   * Garam Setup: the G with a download arrow at the lower right.
   *
   * The setup is not one of the apps, but it is the front door to them, so it
   * keeps the family's G and takes the one mark nobody has to learn.
   *
   * Two parts, not three: the obvious third — a bar under the arrow, the tray
   * it lands in — is what makes the symbol unmistakable at poster size and
   * three grey pixels at 32, which is the size this icon actually lives at in a
   * taskbar. A shaft with a solid head beside a G reads as a download without
   * it.
   */
  download(x, y, s, small) {
    if (small) return gMark(x, y, s, { radius: 0.33, weight: 0.108 })
    if (gMark(x, y, s)) return true

    // Everything here sits clear of the G's ring, whose outer edge is 0.27s
    // from the centre. The first attempt started the shaft at 0.6s, which is
    // 0.255s out along this diagonal — inside the stroke — and the arrow fused
    // into the G as a blob. The nearest corner below is 0.318s out.
    const cx = s * 0.775

    // Shaft.
    if (Math.abs(x - cx) <= s * 0.028 && y >= s * 0.7 && y <= s * 0.78) return true

    // Head: a triangle narrowing to its point at the bottom.
    const top = s * 0.76
    const tip = s * 0.87
    if (y < top || y > tip) return false
    return Math.abs(x - cx) <= s * 0.088 * ((tip - y) / (tip - top))
  },
}

/**
 * Renders an RGBA buffer at one size.
 *
 * The background is not a flat gradient. A plain two-stop ramp averages to a
 * single colour once the icon is 16px in a tray, which is how the first version
 * lost the blue-to-purple entirely. Two cheap touches keep it reading as a lit
 * object at every size:
 *
 * - a SHEEN, a soft highlight off the top-left, so the face has a light source;
 * - a RIM, brighter along the top-left edge and darker along the bottom-right,
 *   which is what separates a crafted icon from a coloured rectangle.
 *
 * Both are subtle on purpose: strong enough to survive the downscale to 16px,
 * weak enough not to muddy the accent.
 */
function renderIcon(size, accentSpec, glyphName) {
  const S = size * SS
  const { from, to } = normalizeAccent(accentSpec)
  const glyph = GLYPHS[glyphName] ?? GLYPHS.crop

  // Below this the secondary mark cannot resolve, so the glyph simplifies.
  const small = size <= 24

  const inset = S * 0.045
  const centre = S / 2
  const half = centre - inset
  const radius = S * 0.22
  const rim = S * 0.045

  const rgba = Buffer.alloc(size * size * 4)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0
      let fgHits = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px * SS + sx + 0.5
          const y = py * SS + sy + 0.5
          if (roundedSquareDistance(x, y, centre, centre, half, radius) > 0) continue
          bgHits++
          if (glyph(x, y, S, small)) fgHits++
        }
      }

      const total = SS * SS
      const alpha = bgHits / total
      const fg = bgHits > 0 ? fgHits / bgHits : 0

      // Everything below is evaluated once at the pixel centre: these are all
      // smooth fields, so supersampling them would cost 16x for no difference.
      const nx = (px + 0.5) / size
      const ny = (py + 0.5) / size

      // Diagonal ramp, top-left to bottom-right.
      const t = (nx + ny) / 2
      const channels = [0, 1, 2].map((c) => from[c] + (to[c] - from[c]) * t)

      // Sheen: a broad highlight centred off the top-left corner.
      const sheen = Math.max(0, 1 - Math.hypot(nx - 0.28, ny - 0.22) / 0.9) ** 2.4

      // Rim: how close this pixel is to the edge (1 at the edge, 0 further in),
      // and which edge it is on (positive toward the top-left).
      const depth = -roundedSquareDistance((px + 0.5) * SS, (py + 0.5) * SS, centre, centre, half, radius)
      const nearEdge = Math.max(0, 1 - depth / rim)
      const facing = -((nx - 0.5) + (ny - 0.5))

      const i = (py * size + px) * 4
      for (let c = 0; c < 3; c++) {
        let v = channels[c]
        v += (255 - v) * sheen * 0.17
        const lift = nearEdge * facing * 1.35
        v += lift > 0 ? (255 - v) * lift : v * lift
        rgba[i + c] = Math.round(Math.max(0, Math.min(255, v)) * (1 - fg) + 255 * fg)
      }
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }

  return rgba
}

// ── Public API ─────────────────────────────────────────────────────────────

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/**
 * Writes icon.png (256) and a multi-size icon.ico into `outDir`.
 * Unless `tray: false` is passed it also writes tray.png (16) and tray@2x.png (32).
 */
/**
 * @param trayFiles Explicit tray outputs as `{ name, size }`. An app whose tray
 *   changes with state needs more than one icon under names of its own choosing
 *   (g-recorder: idle vs recording), which the default pair cannot express.
 * @param appIcon Set false when a call is only producing extra tray variants,
 *   so it does not overwrite the app icon the previous call just wrote.
 */
export async function buildIcons({
  outDir,
  accent,
  glyph,
  tray = true,
  trayFiles = null,
  appIcon = true,
}) {
  await fs.mkdir(outDir, { recursive: true })

  const pngFor = (size) => encodePng(renderIcon(size, accent, glyph), size)
  const written = []

  const trayOutputs =
    trayFiles ??
    (tray !== false
      ? [
          { name: 'tray.png', size: 16 },
          { name: 'tray@2x.png', size: 32 },
        ]
      : [])

  for (const { name, size } of trayOutputs) {
    await fs.writeFile(join(outDir, name), pngFor(size))
    written.push(name)
  }

  if (appIcon) {
    await fs.writeFile(join(outDir, 'icon.png'), pngFor(256))
    const entries = ICO_SIZES.map((size) => ({ size, png: pngFor(size) }))
    await fs.writeFile(join(outDir, 'icon.ico'), encodeIco(entries))
    written.push('icon.png', 'icon.ico')
  }

  return { outDir, files: written, icoSizes: appIcon ? ICO_SIZES : [] }
}
