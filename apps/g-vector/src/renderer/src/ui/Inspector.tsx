/**
 * The properties panel.
 *
 * One panel that changes with the selection, rather than a stack of panels each
 * holding one row. Everything about the selected object is on this screen and
 * nothing has to be summoned from a menu.
 *
 * It is split in two on purpose. The transform numbers follow the DRAG, so they
 * are live and re-render with it. Fill, stroke, opacity and arrange can only
 * change through this panel, so they read the committed document and are
 * memoised — during a drag they are skipped entirely rather than re-rendering a
 * colour picker and a slider sixty times a second for no change at all.
 */
import { memo, type ReactElement } from 'react'
import { ColorPicker, Slider } from '@garam/ui'
import { localBounds, selectionFrame } from '../doc/bounds'
import { DOCUMENT_SWATCHES } from '../doc/defaults'
import { matrixRotation, rectCenter, round, type Rect } from '../doc/geom'
import { rotateNodes, scaleNodes, setLocalBox, translateNodes, updateNodes } from '../doc/ops'
import { nodesById, solid, type Doc, type NodeId, type Paint, type SceneNode } from '../doc/types'
import { activeDoc, useEditor } from '../store/editor'
import { NumberField } from './NumberField'

type Commit = (doc: Doc) => void
type ZMove = 'front' | 'forward' | 'backward' | 'back'

/** One value shared by the whole selection, or null when they disagree. */
function shared<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null
  return values.every((v) => v === values[0]) ? values[0] : null
}

export function Inspector(): ReactElement {
  const doc = useEditor((s) => s.doc)
  const preview = useEditor((s) => s.preview)
  const selection = useEditor((s) => s.selection)
  const commit = useEditor((s) => s.commit)
  const reorderSelection = useEditor((s) => s.reorderSelection)

  const nodes = nodesById(activeDoc({ doc, preview }), selection)
  const frame = selectionFrame(nodes)

  if (nodes.length === 0 || !frame) {
    return (
      <aside className="gv-inspector">
        <div className="gv-inspector__empty">
          <p>Nothing selected.</p>
          <p className="gv-inspector__hint">
            Drag with <kbd>R</kbd> or <kbd>E</kbd> to draw. Hold <kbd>Ctrl</kbd> while dragging to
            switch the guides off.
          </p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="gv-inspector">
      <header className="gv-inspector__head">
        <span className="gv-inspector__title">
          {nodes.length === 1 ? nodes[0].name : `${nodes.length} objects`}
        </span>
      </header>

      <Transform
        bounds={frame.bounds}
        nodes={nodes}
        doc={doc}
        selection={selection}
        commit={commit}
      />
      <Appearance doc={doc} selection={selection} commit={commit} />
      <Arrange reorder={reorderSelection} />
    </aside>
  )
}

/* ── Transform: follows the drag ─────────────────────────────────────────── */

function Transform({
  bounds,
  nodes,
  doc,
  selection,
  commit,
}: {
  bounds: Rect
  /** From the LIVE document, so the numbers move with a drag. */
  nodes: readonly SceneNode[]
  /** The committed document — what an edit typed here is applied to. */
  doc: Doc
  selection: NodeId[]
  commit: Commit
}): ReactElement {
  const single = nodes.length === 1 ? nodes[0] : null
  const rotation = shared(nodes.map((n) => round(matrixRotation(n.transform), 2)))

  const moveTo = (axis: 'x' | 'y', value: number): void => {
    const delta = value - (axis === 'x' ? bounds.x : bounds.y)
    commit(translateNodes(doc, selection, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0))
  }

  const resizeTo = (axis: 'width' | 'height', value: number): void => {
    if (value <= 0) return
    if (single) {
      commit(setLocalBox(doc, single.id, { ...localBounds(single), [axis]: value }))
      return
    }
    // A multi-selection scales about its top-left, so the corner the user is
    // reading the X and Y from stays where it is.
    const factor = value / (axis === 'width' ? bounds.width : bounds.height)
    commit(
      scaleNodes(
        doc,
        selection,
        { x: bounds.x, y: bounds.y },
        axis === 'width' ? factor : 1,
        axis === 'height' ? factor : 1,
      ),
    )
  }

  const rotateTo = (degrees: number): void => {
    const pivot = rectCenter(bounds)
    // With several nodes there is no shared starting angle to correct from, so
    // the field applies the value as a turn rather than as an absolute.
    const turn = single ? degrees - matrixRotation(single.transform) : degrees
    commit(rotateNodes(doc, selection, turn, pivot))
  }

  return (
    <section className="gv-group">
      <h3 className="gv-group__title">Transform</h3>
      <div className="gv-grid2">
        <Cell label="X">
          <NumberField aria-label="X" value={round(bounds.x, 2)} onCommit={(v) => moveTo('x', v)} />
        </Cell>
        <Cell label="Y">
          <NumberField aria-label="Y" value={round(bounds.y, 2)} onCommit={(v) => moveTo('y', v)} />
        </Cell>
        <Cell label="W">
          <NumberField
            aria-label="Width"
            min={1}
            value={round(bounds.width, 2)}
            onCommit={(v) => resizeTo('width', v)}
          />
        </Cell>
        <Cell label="H">
          <NumberField
            aria-label="Height"
            min={1}
            value={round(bounds.height, 2)}
            onCommit={(v) => resizeTo('height', v)}
          />
        </Cell>
        <Cell label="∠">
          <NumberField aria-label="Rotation" suffix="°" value={rotation} onCommit={rotateTo} />
        </Cell>
        {single?.type === 'rect' && (
          <Cell label="⌜">
            <NumberField
              aria-label="Corner radius"
              min={0}
              value={single.radius}
              onCommit={(v) =>
                commit(
                  updateNodes(doc, [single.id], {
                    radius: Math.min(v, Math.min(single.width, single.height) / 2),
                  }),
                )
              }
            />
          </Cell>
        )}
      </div>
    </section>
  )
}

/* ── Appearance: only this panel can change it, so it can be memoised ────── */

const Appearance = memo(function Appearance({
  doc,
  selection,
  commit,
}: {
  doc: Doc
  selection: NodeId[]
  commit: Commit
}): ReactElement | null {
  const nodes = nodesById(doc, selection)
  if (nodes.length === 0) return null

  const fill = shared(nodes.map((n) => paintKey(n.fill)))
  const strokeColour = shared(nodes.map((n) => paintKey(n.stroke.paint)))
  const strokeWidth = shared(nodes.map((n) => n.stroke.width))
  const opacity = shared(nodes.map((n) => n.opacity))

  return (
    <>
      <section className="gv-group">
        <h3 className="gv-group__title">Fill</h3>
        <div className="gv-row">
          <ColorPicker
            value={fill ?? '#5c4bea'}
            swatches={DOCUMENT_SWATCHES}
            onChange={(colour) => commit(updateNodes(doc, selection, { fill: solid(colour) }))}
            label="Fill"
          />
          <span className="gv-row__value">{fill ?? 'Mixed'}</span>
        </div>
      </section>

      <section className="gv-group">
        <h3 className="gv-group__title">Stroke</h3>
        <div className="gv-row">
          <ColorPicker
            value={strokeColour ?? '#1f2933'}
            swatches={DOCUMENT_SWATCHES}
            onChange={(colour) =>
              commit(
                updateNodes(doc, selection, {
                  stroke: { ...nodes[0].stroke, paint: solid(colour) },
                }),
              )
            }
            label="Stroke"
          />
          <NumberField
            aria-label="Stroke width"
            min={0}
            value={strokeWidth}
            onCommit={(v) =>
              commit(updateNodes(doc, selection, { stroke: { ...nodes[0].stroke, width: v } }))
            }
          />
        </div>
      </section>

      <section className="gv-group">
        <h3 className="gv-group__title">Opacity</h3>
        <Slider
          min={0}
          max={100}
          value={Math.round((opacity ?? 1) * 100)}
          onChange={(v) => commit(updateNodes(doc, selection, { opacity: v / 100 }))}
        />
      </section>
    </>
  )
})

const Arrange = memo(function Arrange({
  reorder,
}: {
  reorder: (move: ZMove) => void
}): ReactElement {
  const moves: ZMove[] = ['front', 'forward', 'backward', 'back']
  return (
    <section className="gv-group">
      <h3 className="gv-group__title">Arrange</h3>
      <div className="gv-arrange">
        {moves.map((move) => (
          <button key={move} type="button" onClick={() => reorder(move)}>
            {move[0].toUpperCase() + move.slice(1)}
          </button>
        ))}
      </div>
    </section>
  )
})

function Cell({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <label className="gv-cell">
      <span className="gv-cell__label">{label}</span>
      {children}
    </label>
  )
}

/** A paint reduced to one comparable string, for the "do they agree" test. */
function paintKey(paint: Paint): string {
  return paint.kind === 'solid' ? paint.color : paint.kind
}
