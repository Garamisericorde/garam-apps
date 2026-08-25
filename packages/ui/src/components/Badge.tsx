import type { ReactNode } from 'react'
import { cx } from '../cx'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export function Badge({
  tone = 'neutral',
  dot,
  children,
  className,
}: {
  tone?: BadgeTone
  /** Solda nabiz atan nokta goster (canli durum gostergesi). */
  dot?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cx('g-badge', `g-badge--${tone}`, className)}>
      {dot && <span className="g-badge__dot" />}
      {children}
    </span>
  )
}
