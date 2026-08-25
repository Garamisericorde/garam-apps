import { useEffect, useState } from 'react'
import type { DisplayShot } from '@shared/types'

export interface LoadedShot extends DisplayShot {
  image: HTMLImageElement
}

/**
 * Data URL'leri HTMLImageElement'e cevirir ve hepsi yuklenene kadar bekler.
 * Konva goruntuleri cizmek icin yuklenmis bir element ister.
 */
export function useImages(shots: DisplayShot[]): LoadedShot[] | null {
  const [loaded, setLoaded] = useState<LoadedShot[] | null>(null)

  useEffect(() => {
    if (shots.length === 0) {
      setLoaded(null)
      return
    }

    let cancelled = false

    const load = (shot: DisplayShot): Promise<LoadedShot> =>
      new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve({ ...shot, image })
        image.onerror = () => reject(new Error(`Ekran goruntusu yuklenemedi: ${shot.displayId}`))
        image.src = shot.dataUrl
      })

    Promise.all(shots.map(load))
      .then((result) => {
        if (!cancelled) setLoaded(result)
      })
      .catch((err) => {
        console.error('[overlay] goruntuler yuklenemedi', err)
        if (!cancelled) setLoaded([])
      })

    return () => {
      cancelled = true
    }
  }, [shots])

  return loaded
}
