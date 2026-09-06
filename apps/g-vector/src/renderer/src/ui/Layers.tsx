/**
 * The layers list: layers, each holding the objects drawn on it.
 *
 * Top of the list is top of the stack, which is the opposite of the document's
 * own order — both `doc.layers` and `doc.nodes` run bottom to top — so every
 * list here is a reverse of one of them. That conversion is the classic layers
 * bug when it is spread around, so it happens on the way in and nowhere else.
 *
 * Drop targets are found by asking the DOM what is under the pointer rather
 * than by arithmetic on row heights. It is shorter, it survives a row changing
 * height, and it makes dropping an object onto a LAYER row — which moves it to
 * that layer — the same code path as dropping it onto a sibling.
 */
import { useCallback, useRef, useState, type PointerEvent, type ReactElement } from 'react'
import { IconButton } from '@garam/ui'
import type { Layer, LayerId, SceneNode } from '../doc/types'
import { activeDoc, useEditor } from '../store/editor'
import { pickAndPlaceImage } from './images'
import {
  EllipseGlyph,
  EyeIcon,
  EyeOffIcon,
  ImageGlyph,
  ImageIcon,
  LockIcon,
  PathGlyph,
  PlusIcon,
  RectGlyph,
  TrashIcon,
  UnlockIcon,
} from './icons'

/** How far a press has to travel before it is a reorder and not a click. */
const DRAG_THRESHOLD = 4

interface RowRef {
  kind: 'layer' | 'node'
  id: string
  /** For a node row, the layer it currently sits on. */
  group: LayerId | null
  /** Position within its own group, top-first. */
  slot: number
}

interface Drag {
  from: RowRef
  startY: number
  over: RowRef | null
}

export function Layers(): ReactElement {
  const doc = useEditor((s) => s.doc)
  const preview = useEditor((s) => s.preview)
  const selection = useEditor((s) => s.selection)
  const activeLayer = useEditor((s) => s.activeLayer)

  const setSelection = useEditor((s) => s.setSelection)
  const toggleSelection = useEditor((s) => s.toggleSelection)
  const setNodeFlag = useEditor((s) => s.setNodeFlag)
  const moveNode = useEditor((s) => s.moveNode)
  const setActiveLayer = useEditor((s) => s.setActiveLayer)
  const newLayer = useEditor((s) => s.newLayer)
  const deleteLayer = useEditor((s) => s.deleteLayer)
  const setLayerFlag = useEditor((s) => s.setLayerFlag)
  const moveLayer = useEditor((s) => s.moveLayer)
  const moveSelectionToLayer = useEditor((s) => s.moveSelectionToLayer)

  const live = activeDoc({ doc, preview })
  const layers = [...live.layers].reverse()
  const nodesOf = (layer: LayerId): SceneNode[] =>
    live.nodes.filter((node) => node.layer === layer).reverse()

  const [collapsed, setCollapsed] = useState<Set<LayerId>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const drag = useRef<Drag | null>(null)
  const [dropOn, setDropOn] = useState<RowRef | null>(null)

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>, row: RowRef): void => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { from: row, startY: event.clientY, over: null }

      if (row.kind === 'layer') {
        setActiveLayer(row.id)
        return
      }
      // Picking an object also switches to its layer: the next thing drawn
      // almost always belongs with the thing just clicked.
      if (row.group) setActiveLayer(row.group)
      if (event.shiftKey) toggleSelection(row.id)
      else if (!selection.includes(row.id)) setSelection([row.id])
    },
    [selection, setActiveLayer, setSelection, toggleSelection],
  )

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current) return
    if (!current.over && Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD) return
    const over = rowUnder(event.clientX, event.clientY)
    current.over = over
    setDropOn(over && !sameRow(over, current.from) ? over : null)
  }, [])

  const onPointerUp = useCallback((): void => {
    const current = drag.current
    drag.current = null
    setDropOn(null)
    if (!current?.over || sameRow(current.over, current.from)) return
    const { from, over } = current

    if (from.kind === 'layer') {
      if (over.kind !== 'layer') return
      // The list is upside down, so a slot from the top is counted from the end.
      moveLayer(from.id, live.layers.length - 1 - over.slot)
      return
    }

    const target = over.kind === 'layer' ? over.id : over.group
    if (target && target !== from.group) {
      moveSelectionToLayer(target)
      return
    }
    if (over.kind === 'node') {
      const count = live.nodes.filter((node) => node.layer === from.group).length
      moveNode(from.id, count - 1 - over.slot)
    }
  }, [live.layers.length, live.nodes, moveLayer, moveNode, moveSelectionToLayer])

  const rowProps = (row: RowRef) => ({
    'data-row-kind': row.kind,
    'data-row-id': row.id,
    'data-row-group': row.group ?? '',
    'data-row-slot': String(row.slot),
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => onPointerDown(event, row),
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => {
      drag.current = null
      setDropOn(null)
    },
  })

  return (
    <aside className="gv-layers">
      <header className="gv-layers__head">
        <span className="gv-layers__title">Layers</span>
        <div className="gv-layers__actions">
          <IconButton
            icon={<PlusIcon />}
            label="New layer"
            size="sm"
            tooltipSide="left"
            onClick={newLayer}
          />
          <IconButton
            icon={<ImageIcon />}
            label="Place image"
            size="sm"
            /* Left, not the default bottom: this panel is against the right
               edge of the window, and a tooltip centred under a button that
               close to the edge hangs half of itself off the screen. */
            tooltipSide="left"
            onClick={() => void pickAndPlaceImage()}
          />
        </div>
      </header>

      <div className="gv-layers__list">
        {layers.map((layer, slot) => {
          const row: RowRef = { kind: 'layer', id: layer.id, group: null, slot }
          const contents = nodesOf(layer.id)
          const open = !collapsed.has(layer.id)
          return (
            <div key={layer.id}>
              <div
                className={layerClass(layer, layer.id === activeLayer, dropOn, row)}
                {...rowProps(row)}
              >
                <button
                  type="button"
                  className="gv-layers__twist"
                  aria-label={open ? 'Collapse' : 'Expand'}
                  aria-expanded={open}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() =>
                    setCollapsed((was) => {
                      const next = new Set(was)
                      if (!next.delete(layer.id)) next.add(layer.id)
                      return next
                    })
                  }
                >
                  <span className={open ? 'is-open' : undefined}>›</span>
                </button>

                <Flags
                  visible={layer.visible}
                  locked={layer.locked}
                  onVisible={() => setLayerFlag(layer.id, { visible: !layer.visible })}
                  onLocked={() => setLayerFlag(layer.id, { locked: !layer.locked })}
                />

                {renaming === layer.id ? (
                  <Rename
                    value={layer.name}
                    onDone={(name) => {
                      if (name) setLayerFlag(layer.id, { name })
                      setRenaming(null)
                    }}
                  />
                ) : (
                  <span
                    className="gv-layers__name gv-layers__name--layer"
                    onDoubleClick={() => setRenaming(layer.id)}
                  >
                    {layer.name}
                  </span>
                )}

                <input
                  className="gv-layers__opacity"
                  type="number"
                  min={0}
                  max={100}
                  aria-label={`${layer.name} opacity`}
                  value={Math.round(layer.opacity * 100)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    const percent = Number(event.target.value)
                    if (Number.isFinite(percent)) {
                      setLayerFlag(layer.id, { opacity: Math.min(100, Math.max(0, percent)) / 100 })
                    }
                  }}
                />

                <button
                  type="button"
                  className="gv-layers__flag gv-layers__delete"
                  aria-label="Delete layer"
                  /* The last layer stays. A document with nowhere to put the
                     next thing drawn is a document in a state nothing else
                     copes with. */
                  disabled={live.layers.length <= 1}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => deleteLayer(layer.id)}
                >
                  <TrashIcon />
                </button>
              </div>

              {open &&
                contents.map((node, nodeSlot) => {
                  const nodeRow: RowRef = {
                    kind: 'node',
                    id: node.id,
                    group: layer.id,
                    slot: nodeSlot,
                  }
                  return (
                    <div
                      key={node.id}
                      className={nodeClass(node, selection.includes(node.id), dropOn, nodeRow)}
                      {...rowProps(nodeRow)}
                    >
                      <Flags
                        visible={node.visible}
                        locked={node.locked}
                        onVisible={() => setNodeFlag(node.id, { visible: !node.visible })}
                        onLocked={() => setNodeFlag(node.id, { locked: !node.locked })}
                      />
                      <span className="gv-layers__glyph">{glyphFor(node)}</span>
                      {renaming === node.id ? (
                        <Rename
                          value={node.name}
                          onDone={(name) => {
                            if (name) setNodeFlag(node.id, { name })
                            setRenaming(null)
                          }}
                        />
                      ) : (
                        <span
                          className="gv-layers__name"
                          onDoubleClick={() => setRenaming(node.id)}
                        >
                          {node.name}
                        </span>
                      )}
                    </div>
                  )
                })}

              {open && contents.length === 0 && (
                <p className="gv-layers__empty">Empty — draw here.</p>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function Flags({
  visible,
  locked,
  onVisible,
  onLocked,
}: {
  visible: boolean
  locked: boolean
  onVisible: () => void
  onLocked: () => void
}): ReactElement {
  return (
    <>
      <button
        type="button"
        className="gv-layers__flag"
        aria-label={visible ? 'Hide' : 'Show'}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onVisible}
      >
        {visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>
      <button
        type="button"
        className="gv-layers__flag"
        aria-label={locked ? 'Unlock' : 'Lock'}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onLocked}
      >
        {locked ? <LockIcon /> : <UnlockIcon />}
      </button>
    </>
  )
}

function Rename({
  value,
  onDone,
}: {
  value: string
  onDone: (name: string) => void
}): ReactElement {
  return (
    <input
      className="gv-layers__rename"
      defaultValue={value}
      autoFocus
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => onDone(event.target.value.trim())}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.currentTarget.value = value
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** The row under the pointer, read straight off the DOM. */
function rowUnder(x: number, y: number): RowRef | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const kind = element.getAttribute('data-row-kind')
    if (kind !== 'layer' && kind !== 'node') continue
    const group = element.getAttribute('data-row-group')
    return {
      kind,
      id: element.getAttribute('data-row-id') ?? '',
      group: group ? group : null,
      slot: Number(element.getAttribute('data-row-slot') ?? '0'),
    }
  }
  return null
}

function sameRow(a: RowRef, b: RowRef): boolean {
  return a.kind === b.kind && a.id === b.id
}

function layerClass(layer: Layer, active: boolean, dropOn: RowRef | null, row: RowRef): string {
  return [
    'gv-layer-row',
    active && 'is-active',
    !layer.visible && 'is-hidden',
    layer.locked && 'is-locked',
    dropOn && sameRow(dropOn, row) && 'is-drop',
  ]
    .filter(Boolean)
    .join(' ')
}

function nodeClass(
  node: SceneNode,
  selected: boolean,
  dropOn: RowRef | null,
  row: RowRef,
): string {
  return [
    'gv-layer',
    selected && 'is-selected',
    !node.visible && 'is-hidden',
    node.locked && 'is-locked',
    dropOn && sameRow(dropOn, row) && 'is-drop',
  ]
    .filter(Boolean)
    .join(' ')
}

function glyphFor(node: SceneNode): ReactElement {
  switch (node.type) {
    case 'rect':
      return <RectGlyph />
    case 'ellipse':
      return <EllipseGlyph />
    case 'image':
      return <ImageGlyph />
    case 'path':
      return <PathGlyph />
  }
}
