import { useEffect, useState } from 'react'
import { Input } from '@garam/ui'

/** Keys that need translating into Electron accelerator names. */
const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  PrintScreen: 'PrintScreen',
  Enter: 'Return',
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

export interface HotkeyInputProps {
  value: string
  onChange: (accelerator: string) => void
  /** Show a warning when the OS refused to register the shortcut. */
  invalid?: boolean
  id?: string
}

/**
 * Waits for a key combination once clicked and converts it into an Electron
 * accelerator string. Pressing modifiers alone is not accepted.
 */
export function HotkeyInput({ value, onChange, invalid, id }: HotkeyInputProps) {
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing) return

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setCapturing(false)
        return
      }

      // Keep waiting while only modifier keys are held.
      if (MODIFIER_KEYS.has(e.key)) return

      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')
      if (e.metaKey) parts.push('Super')

      const key = KEY_ALIASES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
      parts.push(key)

      onChange(parts.join('+'))
      setCapturing(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturing, onChange])

  return (
    <Input
      id={id}
      readOnly
      invalid={invalid}
      className="snap-hotkey-input"
      value={capturing ? 'Press keys...' : value}
      placeholder="Not set"
      onFocus={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onClick={() => setCapturing(true)}
    />
  )
}
