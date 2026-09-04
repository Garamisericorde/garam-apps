import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Icon rendered to the left of the label. */
  icon?: ReactNode
  /** Stretch to the full width of the container. */
  block?: boolean
  /** Pressed / selected appearance. */
  active?: boolean
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  block,
  active,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'g-btn',
        `g-btn--${variant}`,
        `g-btn--${size}`,
        block && 'g-btn--block',
        active && 'is-active',
        className,
      )}
      {...rest}
    >
      {icon && <span className="g-btn__icon">{icon}</span>}
      {children}
    </button>
  )
}
