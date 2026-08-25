import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  /** Erisilebilirlik etiketi; ayni zamanda tooltip metni olur. */
  label: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'ghost' | 'danger'
  active?: boolean
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
  /** Tooltip'i kapat (or. zaten metin gosteren yerlerde). */
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
