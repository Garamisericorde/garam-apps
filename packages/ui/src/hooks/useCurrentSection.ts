import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Which section of a long page you are currently looking at.
 *
 * Two things make this harder than it looks, and both produced a marker that
 * pointed at a section the user was not looking at:
 *
 * 1. IntersectionObserver, the obvious tool, hands its callback only the
 *    entries whose intersection CHANGED. "The topmost entry" is therefore the
 *    topmost of whatever happened to move, not the topmost of what is on
 *    screen. Positions are read directly here instead: the current section is
 *    the LAST one whose top has passed the line.
 *
 * 2. Near the end of a page the remaining sections cannot reach that line —
 *    there is nothing below them left to push them up there. Clicking the last
 *    category would scroll to it and then light up a different one, which is
 *    exactly the "this app is broken" feeling. So a click PINS its section
 *    until the reader scrolls by hand again; what you asked for stays selected.
 */
export interface CurrentSectionOptions {
  /** Element ids, in the order they appear on the page. */
  ids: string[]
  /**
   * How far below the top of the scrolling area the line sits. Match it to the
   * height of a sticky header, or a section jumped to lands behind it.
   */
  offset?: number
}

export interface CurrentSection {
  /** The id of the section considered current. */
  current: string
  /** Mark a section current because the reader asked for it, and hold it. */
  select: (id: string) => void
}

/** The nearest ancestor that actually scrolls, or null for the page itself. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

export function useCurrentSection({ ids, offset = 56 }: CurrentSectionOptions): CurrentSection {
  const [current, setCurrent] = useState(ids[0] ?? '')

  /**
   * Set while a chosen section is being held.
   *
   * Cleared by a gesture that STARTS a scroll (wheel, touch, a key), never by
   * the scroll event itself — the programmatic scroll a click causes would
   * otherwise unpin the very thing the click just pinned.
   */
  const pinned = useRef(false)

  const select = useCallback((id: string) => {
    pinned.current = true
    setCurrent(id)
  }, [])

  // The ids are usually a fresh array literal on every render, so the effect
  // keys off their contents rather than the array's identity.
  const key = ids.join('|')

  useEffect(() => {
    const first = document.getElementById(ids[0])
    if (!first) return

    const root = scrollParent(first)
    const target: HTMLElement | Window = root ?? window

    const update = (): void => {
      if (pinned.current) return

      const viewport = root ? root.clientHeight : window.innerHeight
      const scrolled = root ? root.scrollTop : window.scrollY
      const total = root ? root.scrollHeight : document.documentElement.scrollHeight

      // The end of the scroll IS the last section: nothing below it can push it
      // up to the line, so geometry alone would never choose it.
      if (scrolled + viewport >= total - 4) {
        setCurrent(ids[ids.length - 1])
        return
      }

      const line = (root ? root.getBoundingClientRect().top : 0) + offset

      let hit = ids[0]
      for (const id of ids) {
        const element = document.getElementById(id)
        if (element && element.getBoundingClientRect().top <= line) hit = id
      }
      setCurrent(hit)
    }

    const release = (): void => {
      pinned.current = false
    }

    update()
    target.addEventListener('scroll', update, { passive: true })
    target.addEventListener('wheel', release, { passive: true })
    target.addEventListener('touchmove', release, { passive: true })
    window.addEventListener('keydown', release)
    window.addEventListener('resize', update)

    return () => {
      target.removeEventListener('scroll', update)
      target.removeEventListener('wheel', release)
      target.removeEventListener('touchmove', release)
      window.removeEventListener('keydown', release)
      window.removeEventListener('resize', update)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offset])

  return { current, select }
}
