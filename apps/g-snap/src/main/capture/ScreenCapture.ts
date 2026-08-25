import { desktopCapturer, screen } from 'electron'
import type { DisplayShot, Rect } from '@shared/types'

/** Yakalamanin gercekten ne urettigini gunluge yazmak icin olcumler. */
export interface CaptureDiagnostic {
  displayId: number
  dipBounds: Rect
  scaleFactor: number
  /** Fiziksel piksel cinsinden istenen boyut. */
  wantedPixels: { width: number; height: number }
  /** desktopCapturer'in gercekten dondurdugu boyut. */
  actualPixels: { width: number; height: number }
  /** display_id ile eslesti mi, yoksa sira tahminine mi dusuldu. */
  matchedById: boolean
}

export interface CaptureResult {
  shots: DisplayShot[]
  /** Tum ekranlari kapsayan dikdortgen (DIP). */
  union: Rect
  diagnostics: CaptureDiagnostic[]
}

/**
 * Bir ekranin gercek piksel boyutunu tahmin eder.
 *
 * NEDEN BU KADAR DIKKATLI:
 * `desktopCapturer` goruntuyu istenen kutuya SIGDIRIR. Kesirli DPI olceginde
 * (or. %110 -> scaleFactor 1.1041666) `bounds * scaleFactor` tam sayi vermez:
 *   2319 x 1.1041666 = 2560.56  ->  yuvarlanirsa 2561
 * 2560 piksellik ekran 2561'e buyutulur, her piksel yeniden orneklenir ve
 * goruntu gozle gorulur sekilde yumusar (olculdu: keskinlik 5.28 -> 4.37).
 *
 * DIP degeri zaten `round(native / scaleFactor)` oldugu icin geri carpim
 * native'i +-1 piksel sasirtabiliyor. Gercek ekran modlarinin genisligi ve
 * yuksekligi HER ZAMAN cift sayi oldugundan en yakin cift tam sayiya
 * yuvarlamak dogru sonucu veriyor (2560.56 -> 2560, 1440.94 -> 1440).
 */
function nativePixelSize(bounds: Rect, scaleFactor: number): { width: number; height: number } {
  return {
    width: roundToEven(bounds.width * scaleFactor),
    height: roundToEven(bounds.height * scaleFactor),
  }
}

/** En yakin cift tam sayiya yuvarlar. */
function roundToEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * Tum ekranlarin anlik goruntusunu alir.
 *
 * Windows notlari:
 * - `screen.getAllDisplays()` DIP cinsinden koordinat verir; birincil ekranin
 *   sol ust kosesi (0,0) kabul edilir, soldaki/ustteki ekranlar NEGATIF x/y alir.
 * - Tek bir `thumbnailSize` tum kaynaklara uygulanir; en buyuk ekrana gore
 *   istiyoruz ve Electron her kaynagi en-boy oranini koruyarak bu kutuya
 *   sigdiriyor, yani kucuk ekranlar dogru cozunurlukte geliyor.
 * - `source.display_id` bazi surucu/sanal ekran kombinasyonlarinda bos gelebilir;
 *   o durumda sira eslemesine dusuyoruz.
 */
export async function captureAllDisplays(): Promise<CaptureResult> {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) {
    throw new Error('Hicbir ekran bulunamadi')
  }

  const natives = displays.map((d) => nativePixelSize(d.bounds, d.scaleFactor))
  const maxPixelWidth = Math.max(...natives.map((n) => n.width))
  const maxPixelHeight = Math.max(...natives.map((n) => n.height))

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxPixelWidth, height: maxPixelHeight },
    fetchWindowIcons: false,
  })

  if (sources.length === 0) {
    throw new Error('Ekran kaynagi alinamadi (desktopCapturer bos dondu)')
  }

  const diagnostics: CaptureDiagnostic[] = []

  const shots: DisplayShot[] = displays.map((display, index) => {
    const byId = sources.find((s) => s.display_id === String(display.id))
    const source = byId ?? sources[index] ?? sources[0]

    const wanted = natives[index]
    const actual = source.thumbnail.getSize()

    diagnostics.push({
      displayId: display.id,
      dipBounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
      wantedPixels: wanted,
      actualPixels: actual,
      matchedById: Boolean(byId),
    })

    return {
      displayId: display.id,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
      scaleFactor: display.scaleFactor,
      // Renderer'in olcek hesaplarini scaleFactor'a degil GERCEKTEN alinan
      // piksel sayisina dayandirmasi icin. Ikisi kesirli DPI'da ayrisir ve
      // aradaki fark bulaniklik olarak geri doner.
      nativeSize: { width: actual.width, height: actual.height },
      dataUrl: source.thumbnail.toDataURL(),
    }
  })

  return {
    shots,
    union: unionBounds(displays.map((d) => d.bounds)),
    diagnostics,
  }
}

/** Yalnizca imlecin bulundugu ekrani yakalar (tam ekran kisayolu icin). */
export async function captureActiveDisplay(): Promise<DisplayShot> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const native = nativePixelSize(display.bounds, display.scaleFactor)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: native,
    fetchWindowIcons: false,
  })

  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source) {
    throw new Error('Etkin ekran yakalanamadi')
  }

  const actual = source.thumbnail.getSize()

  return {
    displayId: display.id,
    bounds: { ...display.bounds },
    scaleFactor: display.scaleFactor,
    nativeSize: { width: actual.width, height: actual.height },
    dataUrl: source.thumbnail.toDataURL(),
  }
}

/** Verilen dikdortgenleri kapsayan en kucuk dikdortgeni hesaplar. */
export function unionBounds(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const maxY = Math.max(...rects.map((r) => r.y + r.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
