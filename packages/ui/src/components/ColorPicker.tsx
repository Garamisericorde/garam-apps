import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { annotationColors } from '@garam/theme'
import { cx } from '../cx'

export interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  /** Preset colors to show; falls back to the @garam/theme palette. */
  swatches?: readonly string[]
  label?: string
  /** Render just the native color input instead of the popover. */
  compact?: boolean
  className?: string
}

/** Which corner of the trigger the popover hangs from. */
interface Placement {
  /** 'start' grows to the right of the trigger, 'end' to the left. */
  align: 'start' | 'end'
  /** 'bottom' hangs below the trigger, 'top' above it. */
  side: 'bottom' | 'top'
}

/** Keep this much clear space between the popover and the screen edge. */
const EDGE_MARGIN = 8

/**
 * Color swatch; clicking opens a preset grid plus a custom color picker.
 */
export function ColorPicker({
  value,
  onChange,
  swatches = annotationColors,
  label = 'Color',
  compact,
  className,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement>({ align: 'start', side: 'bottom' })

  /**
   * Opens wherever there is room.
   *
   * The default (down and to the right) runs off the screen as soon as the
   * trigger sits near an edge — which is exactly where it sits when the
   * annotation panel is pushed to the right of a full-screen selection. The
   * caller should not have to know that, so the popover measures for itself.
   *
   * useLayoutEffect, not useEffect: this has to land before the browser paints,
   * or the popover is visibly drawn in the wrong place and then jumps.
   */
  useLayoutEffect(() => {
    if (!open) return

    const trigger = rootRef.current?.getBoundingClientRect()
    const popover = popoverRef.current?.getBoundingClientRect()
    if (!trigger || !popover) return

    setPlacement({
      align: trigger.left + popover.width > window.innerWidth - EDGE_MARGIN ? 'end' : 'start',
      side: trigger.bottom + popover.height > window.innerHeight - EDGE_MARGIN ? 'top' : 'bottom',
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (compact) {
    return (
      <span className={cx('g-colorpicker', className)}>
        <input
          type="color"
          className="g-colorpicker__native"
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    )
  }

  return (
    <div ref={rootRef} className={cx('g-colorpicker', className)}>
      <button
        type="button"
        className="g-colorpicker__trigger"
        style={{ background: value }}
        aria-label={label}
        aria-expanded={open}
        data-tooltip={label}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div
          ref={popoverRef}
          className={cx(
            'g-colorpicker__popover',
            `g-colorpicker__popover--${placement.align}`,
            `g-colorpicker__popover--${placement.side}`,
          )}
          role="dialog"
          aria-label={label}
        >
          <div className="g-colorpicker__grid">
            {swatches.map((c) => (
              <button
                key={c}
                type="button"
                className={cx(
                  'g-colorpicker__swatch',
                  c.toLowerCase() === value.toLowerCase() && 'is-active',
                )}
                style={{ background: c }}
                aria-label={c}
                onClick={() => {
                  onChange(c)
                  setOpen(false)
                }}
              />
            ))}
          </div>
          <label className="g-colorpicker__custom">
            <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
            <span>Custom color</span>
          </label>
        </div>
      )}
    </div>
  )
}
