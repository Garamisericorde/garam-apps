import { cx } from '../cx'

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** Show the current value on the right. */
  showValue?: boolean
  /** Format the value label (e.g. (v) => `${v} px`). */
  format?: (value: number) => string
  label?: string
  className?: string
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  showValue,
  format,
  label,
  className,
}: SliderProps) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100
  return (
    <div className={cx('g-slider', className)}>
      <input
        type="range"
        className="g-slider__input"
        style={{ '--g-slider-pct': `${pct}%` } as React.CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {showValue && <span className="g-slider__value">{format ? format(value) : value}</span>}
    </div>
  )
}
