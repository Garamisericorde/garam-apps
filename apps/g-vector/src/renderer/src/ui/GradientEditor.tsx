/**
 * The gradient controls: where the ramp points, and how much of it each colour
 * gets.
 *
 * The second half is the one editors usually bury. "Mostly green, black only in
 * the far corner" is not a colour choice, it is a POSITION choice — it means
 * moving the green stop most of the way along the ramp so the fade happens late
 * and fast. So the stops are draggable on a bar that shows the actual ramp,
 * rather than being two swatches with the transition fixed in the middle.
 */
import { useCallback, useRef, useState, type PointerEvent, type ReactElement } from 'react'
import { ColorPicker } from '@garam/ui'
import { DOCUMENT_SWATCHES } from '../doc/defaults'
import { round } from '../doc/geom'
import { flatRampCss, gradientStops, setStop } from '../doc/paint'
import type { Paint } from '../doc/types'
import { NumberField } from './NumberField'

export interface GradientEditorProps {
  paint: Paint
  onChange: (paint: Paint) => void
}

/** Degrees the dial rounds to while Shift is held. */
const ANGLE_STEP = 15

export function GradientEditor({ paint, onChange }: GradientEditorProps): ReactElement | null {
  const stops = gradientStops(paint)
  const barRef = useRef<HTMLDivElement>(null)
  const bar = useRef({ left: 0, width: 1 })
  const [dragging, setDragging] = useState<number | null>(null)

  const onStopDown = useCallback((event: PointerEvent<HTMLElement>, index: number): void => {
    event.stopPropagation()
    const rect = barRef.current?.getBoundingClientRect()
    if (rect) bar.current = { left: rect.left, width: Math.max(1, rect.width) }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(index)
  }, [])

  const onStopMove = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      if (dragging === null) return
      const offset = (event.clientX - bar.current.left) / bar.current.width
      onChange(setStop(paint, dragging, { offset: Math.min(1, Math.max(0, offset)) }))
    },
    [dragging, onChange, paint],
  )

  if (!stops) return null

  return (
    <div className="gv-gradient">
      <div className="gv-gradient__bar" ref={barRef} style={{ background: flatRampCss(paint) }}>
        {stops.map((stop, index) => (
          <button
            key={index}
            type="button"
            className={`gv-gradient__stop${dragging === index ? ' is-dragging' : ''}`}
            aria-label={`Stop ${index + 1} position`}
            style={{ left: `${stop.offset * 100}%`, background: stop.color }}
            onPointerDown={(event) => onStopDown(event, index)}
            onPointerMove={onStopMove}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
          />
        ))}
      </div>

      {stops.map((stop, index) => (
        <div className="gv-gradient__row" key={index}>
          <ColorPicker
            value={stop.color}
            swatches={DOCUMENT_SWATCHES}
            label={`Stop ${index + 1}`}
            onChange={(color) => onChange(setStop(paint, index, { color }))}
          />
          <span className="gv-gradient__hex">{stop.color.toUpperCase()}</span>
          <div className="gv-gradient__pos">
            <NumberField
              aria-label={`Stop ${index + 1} position`}
              suffix="%"
              min={0}
              value={round(stop.offset * 100, 0)}
              onCommit={(percent) =>
                onChange(setStop(paint, index, { offset: Math.min(1, Math.max(0, percent / 100)) }))
              }
            />
          </div>
        </div>
      ))}

      {paint.kind === 'linear' && (
        <div className="gv-gradient__row gv-gradient__row--angle">
          <AngleDial
            angle={paint.angle}
            onChange={(angle) => onChange({ ...paint, angle })}
          />
          <div className="gv-gradient__pos">
            <NumberField
              aria-label="Gradient angle"
              suffix="°"
              value={round(paint.angle, 1)}
              onCommit={(angle) => onChange({ ...paint, angle })}
            />
          </div>
          <div className="gv-gradient__presets">
            {DIRECTIONS.map((preset) => (
              <button
                key={preset.angle}
                type="button"
                aria-label={preset.label}
                title={preset.label}
                className={Math.abs(normalize(paint.angle) - preset.angle) < 0.5 ? 'is-on' : ''}
                onClick={() => onChange({ ...paint, angle: preset.angle })}
              >
                {preset.arrow}
              </button>
            ))}
          </div>
        </div>
      )}

      {paint.kind === 'radial' && (
        <div className="gv-gradient__row">
          <span className="gv-gradient__label">Size</span>
          <div className="gv-gradient__pos">
            <NumberField
              aria-label="Gradient radius"
              suffix="%"
              min={1}
              value={round(paint.radius * 100, 0)}
              onCommit={(percent) => onChange({ ...paint, radius: Math.max(0.01, percent / 100) })}
            />
          </div>
          <span className="gv-gradient__label">Centre</span>
          <div className="gv-gradient__pos">
            <NumberField
              aria-label="Gradient centre X"
              suffix="%"
              value={round(paint.center.x * 100, 0)}
              onCommit={(percent) =>
                onChange({ ...paint, center: { ...paint.center, x: percent / 100 } })
              }
            />
          </div>
          <div className="gv-gradient__pos">
            <NumberField
              aria-label="Gradient centre Y"
              suffix="%"
              value={round(paint.center.y * 100, 0)}
              onCommit={(percent) =>
                onChange({ ...paint, center: { ...paint.center, y: percent / 100 } })
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

/* ── The dial ────────────────────────────────────────────────────────────── */

/**
 * Degrees measured the way SVG measures them: 0 points right, and the angle
 * grows clockwise because the y axis points down.
 */
const DIRECTIONS = [
  { angle: 0, arrow: '→', label: 'Left to right' },
  { angle: 90, arrow: '↓', label: 'Top to bottom' },
  { angle: 180, arrow: '←', label: 'Right to left' },
  { angle: 270, arrow: '↑', label: 'Bottom to top' },
  { angle: 45, arrow: '↘', label: 'Diagonal' },
] as const

function normalize(angle: number): number {
  return ((angle % 360) + 360) % 360
}

/**
 * Drag anywhere in the circle to point the gradient.
 *
 * The whole disc responds, not a handle on its rim: a gradient direction is one
 * number, and asking someone to catch an eight-pixel dot to set it is the
 * reason rotating a gradient is a chore in the tool this replaces.
 */
function AngleDial({
  angle,
  onChange,
}: {
  angle: number
  onChange: (angle: number) => void
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const centre = useRef({ x: 0, y: 0 })
  const [active, setActive] = useState(false)

  const aim = (event: PointerEvent<HTMLDivElement>): void => {
    const dx = event.clientX - centre.current.x
    const dy = event.clientY - centre.current.y
    if (Math.hypot(dx, dy) < 2) return
    const degrees = (Math.atan2(dy, dx) * 180) / Math.PI
    onChange(normalize(event.shiftKey ? Math.round(degrees / ANGLE_STEP) * ANGLE_STEP : degrees))
  }

  const radians = (angle * Math.PI) / 180

  return (
    <div
      ref={ref}
      className={`gv-dial${active ? ' is-active' : ''}`}
      role="slider"
      aria-label="Gradient angle"
      aria-valuenow={Math.round(normalize(angle))}
      aria-valuemin={0}
      aria-valuemax={360}
      tabIndex={0}
      onPointerDown={(event) => {
        const rect = ref.current?.getBoundingClientRect()
        if (rect) centre.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        event.currentTarget.setPointerCapture(event.pointerId)
        setActive(true)
        aim(event)
      }}
      onPointerMove={(event) => {
        if (active) aim(event)
      }}
      onPointerUp={() => setActive(false)}
      onPointerCancel={() => setActive(false)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? ANGLE_STEP : 1
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault()
          onChange(normalize(angle - step))
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault()
          onChange(normalize(angle + step))
        }
      }}
    >
      <span
        className="gv-dial__needle"
        style={{
          transform: `translate(-50%, -50%) rotate(${angle}deg)`,
        }}
      />
      <span
        className="gv-dial__knob"
        style={{
          left: `${50 + Math.cos(radians) * 38}%`,
          top: `${50 + Math.sin(radians) * 38}%`,
        }}
      />
    </div>
  )
}
