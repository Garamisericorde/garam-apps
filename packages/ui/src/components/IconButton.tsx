import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  /** Accessibility label; also used as the tooltip text. */
  label: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'ghost' | 'danger'
  active?: boolean
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
  /** Disable the tooltip (e.g. where a label is already visible). */
  noTooltip?: boolean
}

export function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  active,
  tooltipSide = 'bottom',
  noTooltip,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active}
      data-tooltip={noTooltip ? undefined : label}
      data-tooltip-side={noTooltip ? undefined : tooltipSide}
      className={cx('g-iconbtn', `g-iconbtn--${size}`, `g-iconbtn--${variant}`, active && 'is-active', className)}
      {...rest}
    >
      {icon}
    </button>
  )
}
