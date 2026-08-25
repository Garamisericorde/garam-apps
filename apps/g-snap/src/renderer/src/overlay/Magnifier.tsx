import { useEffect, useRef } from 'react'
import { pixelScaleOf } from '@shared/types'
import type { LoadedShot } from './useImages'
import type { Point } from './types'

const SIZE = 116 // buyutec kutusu (CSS px)
const ZOOM = 8 // kac kat buyutme
const OFFSET = 22 // imlecten uzaklik

export interface MagnifierProps {
  cursor: Point
  shots: LoadedShot[]
  origin: { x: number; y: number }
  stage: { width: number; height: number }
  /** Suren secimin anlik boyutu; varsa buyutec yerine olcu gosterilir. */
  visible: boolean
}

/**
 * Imlecin altindaki pikselleri buyuterek gosterir ve tam renk kodunu verir.
 * Piksel hassasiyetinde secim yapabilmek icin.
 */
export function Magnifier({ cursor, shots, origin, stage, visible }: MagnifierProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Imlecin hangi ekran goruntusune dustugunu bul.
    const shot = shots.find((s) => {
      const left = s.bounds.x - origin.x
      const top = s.bounds.y - origin.y
      return (
        cursor.x >= left &&
        cursor.x < left + s.bounds.width &&
        cursor.y >= top &&
        cursor.y < top + s.bounds.height
      )
    })

    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, SIZE, SIZE)

    if (!shot) return

    // Sahne (DIP) -> kaynak goruntu (gercek piksel).
    // scaleFactor DEGIL pixelScaleOf: kesirli DPI'da ikisi ayrisiyor ve
    // buyutec yanlis pikseli gosteriyor.
    const scale = pixelScaleOf(shot)
    const localX = (cursor.x - (shot.bounds.x - origin.x)) * scale
    const localY = (cursor.y - (shot.bounds.y - origin.y)) * scale
    const span = SIZE / ZOOM // kac kaynak pikseli gosterecegiz

    ctx.drawImage(
      shot.image,
      localX - span / 2,
      localY - span / 2,
      span,
      span,
      0,
      0,
      SIZE,
      SIZE,
    )

    // Merkez piksel isaretcisi
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1
    ctx.strokeRect(SIZE / 2 - ZOOM / 2 - 0.5, SIZE / 2 - ZOOM / 2 - 0.5, ZOOM + 1, ZOOM + 1)
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.strokeRect(SIZE / 2 - ZOOM / 2 - 1.5, SIZE / 2 - ZOOM / 2 - 1.5, ZOOM + 3, ZOOM + 3)

    // Merkez pikselin rengini oku
    try {
      const pixel = ctx.getImageData(SIZE / 2, SIZE / 2, 1, 1).data
      const hex = `#${[pixel[0], pixel[1], pixel[2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`
      if (labelRef.current) {
        labelRef.current.textContent = hex
        labelRef.current.style.setProperty('--swatch', hex)
      }
    } catch {
      // Canvas kirlenmis olabilir (farkli kaynak); renk okumayi atla.
    }
  }, [cursor, shots, origin, visible])

  if (!visible) return null

  // Kutuyu ekran disina tasmayacak sekilde yerlestir.
  const boxW = SIZE + 2
  const boxH = SIZE + 26
  const left = cursor.x + OFFSET + boxW > stage.width ? cursor.x - OFFSET - boxW : cursor.x + OFFSET
  const top = cursor.y + OFFSET + boxH > stage.height ? cursor.y - OFFSET - boxH : cursor.y + OFFSET

  return (
    <div className="snap-magnifier" style={{ left, top }}>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} className="snap-magnifier__canvas" />
      <div className="snap-magnifier__info">
        <span className="snap-magnifier__coords">
          {Math.round(cursor.x + origin.x)}, {Math.round(cursor.y + origin.y)}
        </span>
        <span ref={labelRef} className="snap-magnifier__color" />
      </div>
    </div>
  )
}
