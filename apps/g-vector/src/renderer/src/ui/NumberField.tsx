/**
 * A numeric field that only reports a value when the user has finished with it.
 *
 * Committing on every keystroke means typing "120" over "8" fires an edit for
 * "1", then "12" — three undo steps and two frames of the shape jumping to a
 * width of one unit. So the field holds its own text while focused and commits
 * on Enter or blur; Escape puts back what was there.
 */
import { useRef, useState, type ReactElement } from 'react'
import { Input } from '@garam/ui'
import { round } from '../doc/geom'

export interface NumberFieldProps {
  value: number | null
  onCommit: (value: number) => void
  /** Shown instead of a number when the selection disagrees. */
  placeholder?: string
  suffix?: string
  min?: number
  disabled?: boolean
  'aria-label': string
}

export function NumberField({
  value,
  onCommit,
  placeholder = '—',
  suffix,
  min,
  disabled,
  'aria-label': label,
}: NumberFieldProps): ReactElement {
  /**
   * The in-progress text, or null when the field is not being edited.
   *
   * Deliberately NOT a state variable kept in step with the prop by an effect.
   * An effect that calls setState runs after paint, so every render of a field
   * whose value moved produced a second render and a second paint — and during
   * a resize drag that is every field, every frame.
   */
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const display = value === null ? '' : String(round(value, 2))
  const text = draft ?? display

  const commit = (): void => {
    setDraft(null)
    const parsed = Number(text.replace(',', '.'))
    if (!Number.isFinite(parsed)) return
    onCommit(min !== undefined ? Math.max(min, parsed) : parsed)
  }

  return (
    <div className="gv-number">
      <Input
        ref={inputRef}
        value={text}
        placeholder={value === null ? placeholder : undefined}
        disabled={disabled}
        aria-label={label}
        onFocus={() => setDraft(display)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
            inputRef.current?.blur()
          } else if (event.key === 'Escape') {
            setDraft(null)
            inputRef.current?.blur()
          }
          // Arrow keys nudge the canvas selection; inside a field they belong to
          // the field, so they must not reach the window handler.
          event.stopPropagation()
        }}
      />
      {suffix && <span className="gv-number__suffix">{suffix}</span>}
    </div>
  )
}
