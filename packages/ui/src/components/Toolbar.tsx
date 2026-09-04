import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /** Vertical layout (e.g. the g-snap annotation bar). */
  vertical?: boolean
  /** Floating bar look: shadow, border and rounded corners. */
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
  /** Small uppercase label shown above the group. */
  label?: string
  /** Group inside an inset, recessed box. */
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

/** Fills the remaining space, pushing later items to the right. */
export function ToolbarSpacer() {
  return <div className="g-toolbar__spacer" />
}

export function ToolbarStatus({ children }: { children: ReactNode }) {
  return <div className="g-toolbar__status">{children}</div>
}
