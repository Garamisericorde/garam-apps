import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react'
import { cx } from '../cx'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx('g-input', invalid && 'is-invalid', className)}
      aria-invalid={invalid}
      {...rest}
    />
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx('g-select', className)} {...rest}>
      {children}
    </select>
  )
})
