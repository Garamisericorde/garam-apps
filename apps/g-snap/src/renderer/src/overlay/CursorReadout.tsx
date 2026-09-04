import type { Composite } from './composite'
import type { Point } from './types'

const OFFSET = 18

export interface CursorReadoutProps {
  cursor: Point
  composite: Composite
  /** Device pixels per CSS pixel. */
  dpr: number
  stage: { width: number; height: number }
  visible: boolean
}

/**
 * Cursor position in screen pixels.
 *
 * Deliberately just the coordinates. This started life as a magnifier with a
 * zoomed pixel preview and a hex colour readout, which turned out to be a
 * colour-picker feature in a screenshot tool: it covered the area being
 * selected and told the user nothing they wanted while dragging.
 */
export function CursorReadout({ cursor, composite, dpr, stage, visible }: CursorReadoutProps) {
  if (!visible) return null

  const x = Math.round(composite.union.x + cursor.x * dpr)
  const y = Math.round(composite.union.y + cursor.y * dpr)

  // Keep the chip inside the screen.
  const width = 96
  const height = 22
  const left = cursor.x + OFFSET + width > stage.width ? cursor.x - OFFSET - width : cursor.x + OFFSET
  const top = cursor.y + OFFSET + height > stage.height ? cursor.y - OFFSET - height : cursor.y + OFFSET

  return (
    <div className="snap-coords" style={{ left, top }}>
      {x}, {y}
    </div>
  )
}
