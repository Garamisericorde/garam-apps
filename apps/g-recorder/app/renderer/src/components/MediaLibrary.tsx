import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '../../../shared/types'
import { formatBytes } from '../../../shared/time'
import ContextMenu from './ContextMenu'
import type { MenuPosition } from './ContextMenu'

interface MediaLibraryProps {
  /** Path of the clip currently open, so the list can mark it */
  activePath: string | null
  /** True while a clip is being opened — probing and thumbnails take a moment */
  busy?: boolean
  /** Put a clip on the timeline. Reached by double click, never by one. */
  onOpen: (clipPath: string) => void
  onImport: () => void
  /** Called when a clip leaves the list, so the editor can let go of it */
  onRemoved: (clipPath: string) => void
}

/**
 * The clips this app has saved, as a panel beside the editor.
 *
 * It reads the output folder rather than keeping a list of its own: every
 * replay and recording already lands there, so a curated library would only be
 * a second place for the same files to go missing from.
 *
 * Posters are fetched one at a time as rows appear, never up front — a folder
 * with a hundred replays would otherwise start a hundred FFmpeg processes
 * before the panel could paint.
 */
export default function MediaLibrary({
  activePath,
  busy = false,
  onOpen,
  onImport,
  onRemoved,
}: MediaLibraryProps): JSX.Element {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const posterRequests = useRef(new Set<string>())
  /*
   * The rows the user has picked.
   *
   * Separate from `activePath`, which is whatever the preview is showing: a
   * click picks clips out of the list, and only a double click puts one on the
   * timeline. Adding on one click meant browsing the list appended a clip every
   * time you looked at one.
   */
  const [picked, setPicked] = useState<string[]>([])
  /** Where a shift-click measures its range from */
  const anchor = useRef<string | null>(null)
  const [menu, setMenu] = useState<{ at: MenuPosition; paths: string[] } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const listed = await window.api.media.library()
      setItems((previous) =>
        // Keep posters already fetched; only the file list is re-read.
        listed.map((item) => ({
          ...item,
          poster: previous.find((p) => p.path === item.path)?.poster,
        })),
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // A replay saved from a hotkey or the tray belongs here without a reload.
    return window.api.recorder.onReplaySaved(() => void refresh())
  }, [refresh])

  // A clip opened from outside the output folder is not in the listing yet, and
  // an import that leaves the panel saying "nothing here" reads as a failure.
  useEffect(() => {
    if (!activePath) return
    setItems((previous) => {
      if (previous.some((item) => item.path === activePath)) return previous
      void refresh()
      return previous
    })
  }, [activePath, refresh])

  useEffect(() => {
    const missing = items.find((item) => !item.poster && !posterRequests.current.has(item.path))
    if (!missing) return

    posterRequests.current.add(missing.path)
    let cancelled = false

    void window.api.media.poster(missing.path).then((poster) => {
      if (cancelled || !poster) return
      setItems((previous) =>
        previous.map((item) => (item.path === missing.path ? { ...item, poster } : item)),
      )
    })

    return () => {
      cancelled = true
    }
  }, [items])

  /**
   * Click, ctrl-click and shift-click, as every file list has them.
   *
   * The anchor is the last row picked on its own, not the last row touched: a
   * shift-click extends from where the run started, so widening and narrowing
   * the range is one gesture rather than a fresh selection each time.
   */
  const pick = useCallback(
    (path: string, event: React.MouseEvent): void => {
      const paths = items.map((item) => item.path)

      if (event.shiftKey && anchor.current) {
        const from = paths.indexOf(anchor.current)
        const to = paths.indexOf(path)
        if (from !== -1 && to !== -1) {
          const [low, high] = from < to ? [from, to] : [to, from]
          setPicked(paths.slice(low, high + 1))
          return
        }
      }

      if (event.ctrlKey || event.metaKey) {
        anchor.current = path
        setPicked((previous) =>
          previous.includes(path) ? previous.filter((p) => p !== path) : [...previous, path],
        )
        return
      }

      anchor.current = path
      setPicked([path])
    },
    [items],
  )

  /**
   * What a right-click acts on.
   *
   * A row inside the selection keeps it, so the menu applies to everything
   * picked. A row outside replaces it, because acting on rows the user cannot
   * see the selection of is how files get deleted by accident.
   */
  /** Opening the menu is the same act wherever the row is */
  const openMenu = useCallback(
    (path: string, at: MenuPosition): void => {
      setMenu({ at, paths: menuTargets(path) })
    },
    // menuTargets is declared below; it only reads state through setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked],
  )

  const menuTargets = useCallback(
    (path: string): string[] => {
      if (picked.includes(path)) return picked
      anchor.current = path
      setPicked([path])
      return [path]
    },
    [picked],
  )

  /**
   * The menu for a selection.
   *
   * Every entry names how many it will touch, because a right-click that says
   * "Delete clip" while five rows are lit is a menu you have to count for.
   */
  const menuItems = useCallback(
    (paths: string[]) => {
      const many = paths.length > 1
      const count = `${paths.length} clip${many ? 's' : ''}`

      const forEach = (
        run: (path: string) => Promise<void>,
      ): (() => void) => {
        return () => {
          void Promise.all(paths.map(run)).then(refresh)
          for (const path of paths) onRemoved(path)
          setPicked([])
        }
      }

      return [
        {
          label: 'Add to the timeline',
          onSelect: () => {
            // In list order, so a range added at once lands in the order it
            // was picked out rather than the order the clicks happened.
            for (const item of items) if (paths.includes(item.path)) onOpen(item.path)
          },
        },
        {
          label: 'Show in folder',
          // Explorer selects one file; several would open several windows.
          disabled: many,
          onSelect: () => void window.api.media.revealInFolder(paths[0]),
        },
        {
          /*
           * "Remove", not "Delete": the file stays where it is, and a word that
           * says otherwise is a promise the app is not keeping either way.
           * Still red, because it is the entry that takes something away.
           */
          label: many ? `Remove ${count}` : 'Remove clip',
          destructive: true,
          onSelect: forEach((path) => window.api.media.forget(path)),
        },
      ]
    },
    [items, onOpen, onRemoved, refresh],
  )

  return (
    <aside className="library">
      <div className="library-head">
        <span className="section-title" style={{ margin: 0 }}>
          Clips
        </span>
      </div>

      <button className="btn btn-primary" onClick={onImport} disabled={busy}>
        {busy ? 'Opening…' : 'Import video…'}
      </button>

      <div className="library-list">
        {loading && <p className="small faint">Reading your clips…</p>}

        {/* No empty state: the Import button above is the whole answer to an
            empty list, and a line repeating it is one more thing to read. */}
        {!loading && items.length > 0 && (
          <p className="small faint">
            {picked.length > 1
              ? `${picked.length} selected. Right click for what you can do with them.`
              : 'Double click a clip, or drag it onto the timeline. Shift or Ctrl picks several.'}
          </p>
        )}

        {items.map((item) => (
          <LibraryRow
            key={item.path}
            item={item}
            isActive={item.path === activePath}
            isPicked={picked.includes(item.path)}
            onPick={pick}
            onOpen={onOpen}
            onMenu={openMenu}
          />
        ))}
      </div>

      <ContextMenu
        position={menu?.at ?? null}
        onClose={() => setMenu(null)}
        items={menu ? menuItems(menu.paths) : []}
      />
    </aside>
  )
}


/**
 * One row of the list.
 *
 * Its own memoised component so that picking a clip repaints the two rows
 * whose state changed rather than all of them. Every row holds a poster as a
 * base64 data URI, which is a string of a few hundred kilobytes: re-rendering
 * nine of those on every click is what made selecting one feel late.
 */
const LibraryRow = memo(function LibraryRow({
  item,
  isActive,
  isPicked,
  onPick,
  onOpen,
  onMenu,
}: {
  item: LibraryItem
  isActive: boolean
  isPicked: boolean
  onPick: (path: string, event: React.MouseEvent) => void
  onOpen: (path: string) => void
  onMenu: (path: string, at: MenuPosition) => void
}): JSX.Element {
  return (
    <button
      className={`library-item${isActive ? ' is-active' : ''}${isPicked ? ' is-picked' : ''}`}
      onClick={(event) => onPick(item.path, event)}
      onDoubleClick={() => onOpen(item.path)}
      // Dragging onto the timeline is the same act as double clicking; the drop
      // target reads this back rather than the file, which the renderer is not
      // allowed to construct.
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-grecorder-clip', item.path)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      title={
        isActive
          ? `${item.path} (showing in the preview)`
          : `${item.path} - double click to add it to the timeline`
      }
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(item.path, { x: event.clientX, y: event.clientY })
      }}
    >
      <span className="library-thumb">
        {item.poster ? <img src={item.poster} alt="" draggable={false} /> : null}
      </span>
      <span className="library-meta">
        <span className="library-name">{item.name}</span>
        <span className="small faint">{formatBytes(item.sizeBytes)}</span>
      </span>
    </button>
  )
})
