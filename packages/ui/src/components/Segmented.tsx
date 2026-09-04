import type { ReactNode } from 'react'
import { cx } from '../cx'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

export interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<SegmentedOption<T>>
  size?: 'sm' | 'md'
  className?: string
}

/** Tab-like control for a small set of mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: SegmentedProps<T>) {
  return (
    <div className={cx('g-segmented', `g-segmented--${size}`, className)} role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          className={cx('g-segmented__item', opt.value === value && 'is-active')}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon && <span className="g-segmented__icon">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}
