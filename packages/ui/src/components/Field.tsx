import type { ReactNode } from 'react'
import { cx } from '../cx'

export interface FieldProps {
  label: string
  /** Helper line shown under the label. */
  hint?: string
  /** Validation error; when set it replaces the hint and renders in red. */
  error?: string
  htmlFor?: string
  children: ReactNode
  /** Put the control to the right of the label (row layout) — for settings lists. */
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
