import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  /** Renders in the danger colour; for actions that remove something */
  destructive?: boolean
  disabled?: boolean
}

export interface MenuPosition {
  x: number
  y: number
}

/**
 * A right-click menu.
 *
 * Positioned at the cursor and then nudged back inside the window, because a
 * menu opened near an edge would otherwise run off it — which on a frameless
 * corner means the item you wanted is simply unreachable.
 */
export default function ContextMenu({
  position,
  items,
  onClose,
}: {
  position: MenuPosition | null
  items: MenuItem[]
  onClose: () => void
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [adjusted, setAdjusted] = useState<MenuPosition | null>(null)

  useEffect(() => {
    if (!position) {
      setAdjusted(null)
      return
    }

    const menu = ref.current
    if (!menu) {
      setAdjusted(position)
      return
    }

    const { width, height } = menu.getBoundingClientRect()
    setAdjusted({
      x: Math.min(position.x, window.innerWidth - width - 8),
      y: Math.min(position.y, window.innerHeight - height - 8),
    })
  }, [position])

  useEffect(() => {
    if (!position) return

    /*
     * A pointerdown INSIDE the menu is the click that is about to choose an
     * item — closing on it unmounted the menu before the click could land, so
     * every item silently did nothing. Stopping propagation in the component
     * cannot help: React listens on its root in the bubble phase, and this
     * listener runs first, on window, in the capture phase.
     */
    const dismiss = (event: Event): void => {
      const menu = ref.current
      if (menu && event.target instanceof Node && menu.contains(event.target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    // Capture phase: a click that lands on something else should close this
    // first, not act and leave the menu hanging over the result.
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', dismiss)
    }
  }, [position, onClose])

  if (!position) return null

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: adjusted?.x ?? position.x, top: adjusted?.y ?? position.y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={`context-item${item.destructive ? ' is-destructive' : ''}`}
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
