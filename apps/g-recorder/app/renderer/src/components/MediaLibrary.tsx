import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '../../../shared/types'
import { formatBytes } from '../../../shared/time'

interface MediaLibraryProps {
  /** Path of the clip currently open, so the list can mark it */
  activePath: string | null
  onOpen: (clipPath: string) => void
  onImport: () => void
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
  onOpen,
  onImport,
}: MediaLibraryProps): JSX.Element {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const posterRequests = useRef(new Set<string>())

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

  return (
    <aside className="library">
      <div className="library-head">
        <span className="section-title" style={{ margin: 0 }}>
          Clips
        </span>
      </div>

      <button className="btn btn-primary" onClick={onImport}>
        Import video…
      </button>

      <div className="library-list">
        {loading && <p className="small faint">Reading your clips…</p>}

        {!loading && items.length === 0 && (
          <p className="small faint">
            Nothing here yet. Save a replay, or import a video from anywhere.
          </p>
        )}

        {items.map((item) => (
          <button
            key={item.path}
            className={`library-item${item.path === activePath ? ' is-active' : ''}`}
            onClick={() => onOpen(item.path)}
            // Dragging onto the stage is the same act as clicking; the drop
            // target reads this back rather than the file, which the renderer
            // is not allowed to construct.
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-grecorder-clip', item.path)
              event.dataTransfer.effectAllowed = 'copy'
            }}
            title={item.path}
          >
            <span className="library-thumb">
              {item.poster ? <img src={item.poster} alt="" draggable={false} /> : null}
            </span>
            <span className="library-meta">
              <span className="library-name">{item.name}</span>
              <span className="small faint">{formatBytes(item.sizeBytes)}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
