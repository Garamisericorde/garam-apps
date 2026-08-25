import { cx } from '../cx'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  id?: string
  className?: string
}

export function Switch({ checked, onChange, disabled, label, id, className }: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('g-switch', checked && 'is-on', className)}
    >
      <span className="g-switch__thumb" />
    </button>
  )
}
