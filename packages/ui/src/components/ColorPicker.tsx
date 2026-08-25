import { useEffect, useRef, useState } from 'react'
import { annotationColors } from '@garam/theme'
import { cx } from '../cx'

export interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  /** Gosterilecek hazir renkler; verilmezse @garam/theme paleti kullanilir. */
  swatches?: readonly string[]
  label?: string
  /** Acilir panel yerine sadece yerlesik renk girdisi goster. */
  compact?: boolean
  className?: string
}

/**
 * Ornek renk kutusu; tiklaninca hazir renk izgarasi + ozel renk secici acar.
 */
export function ColorPicker({
  value,
  onChange,
  swatches = annotationColors,
  label = 'Renk',
  compact,
  className,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

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
        <div className="g-colorpicker__popover" role="dialog" aria-label={label}>
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
            <span>Ozel renk</span>
          </label>
        </div>
      )}
    </div>
  )
}
