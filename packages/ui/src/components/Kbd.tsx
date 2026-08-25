import { cx } from '../cx'

/** Klavye kisayolunu gorsel tuslar halinde gosterir: Ctrl+Shift+S */
export function Kbd({ keys, className }: { keys: string; className?: string }) {
  const parts = keys
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
  return (
    <span className={cx('g-kbd', className)}>
      {parts.map((part, i) => (
        <kbd key={`${part}-${i}`} className="g-kbd__key">
          {part}
        </kbd>
      ))}
    </span>
  )
}
