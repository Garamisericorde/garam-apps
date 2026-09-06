import { useCallback, useRef } from 'react'
import { clamp } from '../../../shared/time'
import type { FrameCrop } from '../../../shared/types'

/** The whole frame, which is what "no crop" means */
export const FULL_FRAME: FrameCrop = { x: 0, y: 0, width: 1, height: 1 }

/** Smallest crop that still has something in it, as a fraction of the frame */
const MIN_SIZE = 0.05

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/**
 * A rectangle drawn over the picture, saying what to keep.
 *
 * Drawn here rather than chosen in the export dialog because a crop is a
 * judgement about what is in the frame: the aspect presets can offer a shape
 * without seeing anything, but "only the Discord window" cannot be expressed
 * as a shape at all.
 *
 * It is kept in fractions of the frame. The preview is whatever size the
 * window happens to be, and a rectangle in its pixels would mean something
 * different the moment the window moved.
 */
export default function CropOverlay({
  crop,
  sourceWidth,
  sourceHeight,
  onChange,
}: {
  crop: FrameCrop
  sourceWidth: number
  sourceHeight: number
  onChange: (crop: FrameCrop) => void
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)

  /**
   * Follow the pointer until it is released.
   *
   * Deltas are measured against the picture's own box, which is letterboxed
   * inside the stage, so dragging an edge moves it by what the eye sees rather
   * than by a fraction of the black bars around it.
   */
  const press = useCallback(
    (handle: Handle, event: React.PointerEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      const box = boxRef.current?.getBoundingClientRect()
      if (!box) return

      const startX = event.clientX
      const startY = event.clientY
      const start = crop

      const move = (moveEvent: PointerEvent): void => {
        const dx = (moveEvent.clientX - startX) / box.width
        const dy = (moveEvent.clientY - startY) / box.height
        onChange(resize(start, handle, dx, dy))
      }

      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [crop, onChange],
  )

  return (
    <div className="crop-layer">
      {/*
        * Sized to the picture, not to the stage. A video letterboxed inside a
        * wider stage leaves black bars that are not part of the frame, and a
        * crop drawn over them would cut somewhere else entirely.
        */}
      <div
        ref={boxRef}
        className="crop-frame"
        style={{ aspectRatio: `${sourceWidth} / ${sourceHeight}` }}
      >
        {/* What is being thrown away, dimmed on all four sides */}
        <div className="crop-shade" style={{ inset: `0 0 ${(1 - crop.y) * 100}% 0` }} />
        <div
          className="crop-shade"
          style={{ inset: `${(crop.y + crop.height) * 100}% 0 0 0` }}
        />
        <div
          className="crop-shade"
          style={{
            inset: `${crop.y * 100}% ${(1 - crop.x) * 100}% ${(1 - crop.y - crop.height) * 100}% 0`,
          }}
        />
        <div
          className="crop-shade"
          style={{
            inset: `${crop.y * 100}% 0 ${(1 - crop.y - crop.height) * 100}% ${
              (crop.x + crop.width) * 100
            }%`,
          }}
        />

        <div
          className="crop-rect"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.width * 100}%`,
            height: `${crop.height * 100}%`,
          }}
          onPointerDown={(event) => press('move', event)}
        >
          {HANDLES.map((handle) => (
            <span
              key={handle}
              className={`crop-handle is-${handle}`}
              onPointerDown={(event) => press(handle, event)}
            />
          ))}

          <span className="crop-size">
            {Math.round(crop.width * sourceWidth)} × {Math.round(crop.height * sourceHeight)}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Apply a drag to the rectangle.
 *
 * Each edge is clamped against the opposite one and against the frame, so a
 * handle dragged past its partner stops rather than turning the rectangle
 * inside out.
 */
function resize(crop: FrameCrop, handle: Handle, dx: number, dy: number): FrameCrop {
  if (handle === 'move') {
    return {
      ...crop,
      x: clamp(crop.x + dx, 0, 1 - crop.width),
      y: clamp(crop.y + dy, 0, 1 - crop.height),
    }
  }

  let { x, y, width, height } = crop

  if (handle.includes('w')) {
    const next = clamp(x + dx, 0, x + width - MIN_SIZE)
    width += x - next
    x = next
  }
  if (handle.includes('n')) {
    const next = clamp(y + dy, 0, y + height - MIN_SIZE)
    height += y - next
    y = next
  }
  if (handle.includes('e')) width = clamp(width + dx, MIN_SIZE, 1 - x)
  if (handle.includes('s')) height = clamp(height + dy, MIN_SIZE, 1 - y)

  return { x, y, width, height }
}

/** Whether a crop actually takes anything away */
export function isCropped(crop: FrameCrop): boolean {
  return crop.x > 0.001 || crop.y > 0.001 || crop.width < 0.999 || crop.height < 0.999
}
