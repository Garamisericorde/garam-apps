/**
 * Getting bitmaps into the document.
 *
 * Everything ends up as a data URL. A document that referenced a file path
 * would break the moment the file moved, and an SVG export would carry a link
 * that only resolves on the machine it was made on.
 */
import { useEffect } from 'react'
import { useEditor } from '../store/editor'
import { isTyping } from './typing'

export interface LoadedImage {
  src: string
  natural: { width: number; height: number }
  name: string
}

/** Reads a pasted or dropped blob, and measures it. */
export async function loadImageBlob(blob: Blob, name: string): Promise<LoadedImage> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  return loadImageUrl(src, name)
}

/**
 * Measures a data URL.
 *
 * The natural size is what the image is placed at, so it has to be known before
 * the node exists — a node placed at a guessed size and corrected on load would
 * jump, and would land in the undo history twice.
 */
export async function loadImageUrl(src: string, name: string): Promise<LoadedImage> {
  const natural = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () =>
      resolve({
        // An SVG without an intrinsic size reports 0; something has to be
        // placed, and a square is the least misleading guess.
        width: image.naturalWidth || 512,
        height: image.naturalHeight || 512,
      })
    image.onerror = () => reject(new Error(`Could not read ${name}`))
    image.src = src
  })
  return { src, natural, name }
}

/**
 * Paste and drop, wired to the window.
 *
 * The drop half also stops Chromium doing what it does with an unhandled file
 * drop: navigating the window to it, which replaces the whole editor with a
 * bare image and no way back short of restarting.
 */
export function useImageInput(): void {
  useEffect(() => {
    const place = async (blob: Blob, name: string): Promise<void> => {
      try {
        useEditor.getState().placeImage(await loadImageBlob(blob, name))
      } catch {
        // A clipboard entry that says it is an image but will not decode is not
        // worth interrupting the user over.
      }
    }

    const onPaste = (event: ClipboardEvent): void => {
      if (isTyping(event.target)) return
      for (const item of event.clipboardData?.items ?? []) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        event.preventDefault()
        void place(file, 'Pasted image')
        return
      }
      // Nothing pictorial on the clipboard, so this is a paste of whatever was
      // copied inside the editor.
      event.preventDefault()
      useEditor.getState().pasteClipboard()
    }

    const onDragOver = (event: DragEvent): void => event.preventDefault()

    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      for (const file of event.dataTransfer?.files ?? []) {
        if (file.type.startsWith('image/')) void place(file, file.name)
      }
    }

    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
}

/** The toolbar route: the file dialog, then the same placement. */
export async function pickAndPlaceImage(): Promise<void> {
  const picked = await window.api.image.pick()
  if (!picked) return
  useEditor.getState().placeImage(await loadImageUrl(picked.dataUrl, picked.name))
}
