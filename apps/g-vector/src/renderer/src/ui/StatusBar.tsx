/**
 * The status strip: zoom, what is selected, and whether the guides are live.
 *
 * The snap state is shown here as well as on the rail, because it is the one
 * setting that changes what a drag DOES. A user who cannot see it switched off
 * concludes the editor is broken, which is exactly the trap the tool this
 * replaces falls into.
 */
import type { ReactElement } from 'react'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@garam/ui'
import { useEditor } from '../store/editor'
import { stepZoom } from '../view/viewport'

export function StatusBar(): ReactElement {
  const viewport = useEditor((s) => s.viewport)
  const setZoom = useEditor((s) => s.setZoom)
  const fitArtboard = useEditor((s) => s.fitArtboard)
  const snapEnabled = useEditor((s) => s.snapEnabled)
  const selection = useEditor((s) => s.selection)
  const nodeCount = useEditor((s) => s.doc.nodes.length)

  const percent = Math.round(viewport.zoom * 100)

  return (
    <Toolbar className="gv-status">
      <span className="gv-status__item">
        {selection.length > 0
          ? `${selection.length} selected of ${nodeCount}`
          : `${nodeCount} ${nodeCount === 1 ? 'object' : 'objects'}`}
      </span>

      <ToolbarSpacer />

      <span className={`gv-status__flag ${snapEnabled ? 'is-on' : ''}`}>
        Smart guides {snapEnabled ? 'on' : 'off'}
      </span>

      <ToolbarSeparator />

      <div className="gv-zoom">
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(stepZoom(viewport.zoom, -1))}>
          −
        </button>
        <button type="button" className="gv-zoom__value" onClick={() => setZoom(1)}>
          {percent}%
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(stepZoom(viewport.zoom, 1))}>
          +
        </button>
        <button type="button" className="gv-zoom__fit" onClick={fitArtboard}>
          Fit
        </button>
      </div>
    </Toolbar>
  )
}
