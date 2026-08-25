import type { ReactNode } from 'react'
import { cx } from '../cx'

export interface FieldProps {
  label: string
  /** Etiketin altindaki aciklama satiri. */
  hint?: string
  /** Dogrulama hatasi; verilirse hint yerine kirmizi gosterilir. */
  error?: string
  htmlFor?: string
  children: ReactNode
  /** Kontrolu etiketin sagina koy (satir duzeni) — ayar listeleri icin. */
  inline?: boolean
  className?: string
}

export function Field({ label, hint, error, htmlFor, children, inline, className }: FieldProps) {
  return (
    <div className={cx('g-field', inline && 'g-field--inline', className)}>
      <div className="g-field__text">
        <label className="g-field__label" htmlFor={htmlFor}>
          {label}
        </label>
        {(error || hint) && (
          <span className={cx('g-field__hint', error && 'g-field__hint--error')}>{error || hint}</span>
        )}
      </div>
      <div className="g-field__control">{children}</div>
    </div>
  )
}
