import { cx } from '../cx'

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx('g-spinner', className)}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Yukleniyor"
    />
  )
}
