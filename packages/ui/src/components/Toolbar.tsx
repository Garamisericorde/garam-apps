import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /** Dikey yerlesim (or. g-snap anotasyon cubugu). */
  vertical?: boolean
  /** Yuzen cubuk gorunumu: golge + kenarlik + yuvarlak kose. */
  floating?: boolean
}

export function Toolbar({ vertical, floating, className, children, ...rest }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={cx('g-toolbar', vertical && 'g-toolbar--vertical', floating && 'g-toolbar--floating', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

export interface ToolbarGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Grubun ustunde gosterilen kucuk buyuk-harf etiket. */
  label?: string
  /** Oyuk zeminli kutu icinde grupla. */
  inset?: boolean
}

export function ToolbarGroup({ label, inset, className, children, ...rest }: ToolbarGroupProps) {
  const group = (
    <div className={cx('g-toolbar__group', inset && 'g-toolbar__group--inset', !label && className)} {...(label ? {} : rest)}>
      {children}
    </div>
  )
  if (!label) return group
  return (
    <div className={cx('g-toolbar__category', className)} {...rest}>
      <span className="g-toolbar__label">{label}</span>
      {group}
    </div>
  )
}

export function ToolbarSeparator({ vertical }: { vertical?: boolean }) {
  return <div className={cx('g-toolbar__sep', vertical && 'g-toolbar__sep--vertical')} role="separator" />
}

/** Kalan bosluğu doldurur; sonrasindaki ogeleri saga iter. */
export function ToolbarSpacer() {
  return <div className="g-toolbar__spacer" />
}

export function ToolbarStatus({ children }: { children: ReactNode }) {
  return <div className="g-toolbar__status">{children}</div>
}
