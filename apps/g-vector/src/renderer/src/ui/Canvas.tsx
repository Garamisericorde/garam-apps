/**
 * The canvas: two stacked SVGs and one pointer state machine.
 *
 * The scene SVG carries a viewBox and holds the document in DOCUMENT
 * coordinates. The overlay SVG sits on top at 1:1 and holds the editor's chrome
 * in SCREEN coordinates. Nothing crosses between them except through
 * view/viewport.ts, which is the only place the two spaces meet.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import {
  ensurePath,
  insertAnchorAt,
  refitSubPath,
  removeAnchors,
  sameAnchor,
  toggleCornerAt,
  type AnchorRef,
} from '../doc/anchors'
import { selectionFrame, worldCorners } from '../doc/bounds'
import { createEllipse, createRect } from '../doc/defaults'
import { rectCenter, rectFromCorners, round, type Rect, type Vec } from '../doc/geom'
import { addNodes } from '../doc/ops'
import { type Doc, type EllipseNode, type NodeId, type RectNode } from '../doc/types'
import { Overlay } from '../render/Overlay'
import { Scene } from '../render/Scene'
import { snapBounds } from '../snap/engine'
import { snapAlongRay } from '../snap/ray'
import { collectTargets } from '../snap/targets'
import type { Guide } from '../snap/types'
import {
  angleTo,
  beginResize,
  stepDraw,
  stepMove,
  stepResize,
  stepRotate,
  type DragContext,
  type DragOutput,
  type DrawDrag,
  type Modifiers,
  type MoveDrag,
  type ResizeDrag,
  type RotateDrag,
} from '../tools/drag'
import { handleCursor, handlePoints, hitHandle, hitRotateZone } from '../tools/handles'
import { hitMarquee, hitNode } from '../tools/hit'
import {
  constrainAngle,
  stepAnchorMove,
  stepHandleMove,
  type AnchorMoveDrag,
  type HandleMoveDrag,
} from '../tools/pathDrag'
import {
  anchorPoints,
  anchorsInRect,
  buildPathViews,
  pickPath,
  pickSegment,
  type AnchorView,
  type PathView,
} from '../tools/paths'
import {
  curvatureClick,
  drawGhost,
  lastAnchorWorld,
  penClick,
  previousSegmentLength,
  type DrawGhost,
} from '../tools/penTool'
import { activeDoc, isPathTool, useEditor, type EditorState } from '../store/editor'
import {
  docRectToScreen,
  panBy,
  screenToDoc,
  viewBoxOf,
  zoomAt,
  type Viewport,
} from '../view/viewport'
import { isTyping } from './typing'

/** How far the pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD = 3

/**
 * The angle Shift snaps a new point to, measured from the previous one.
 *
 * 45 rather than 15: while placing points you want the four straight lines and
 * the four diagonals, and a finer step turns "hold Shift for a straight line"
 * into "hold Shift for one of twenty-four almost-straight lines".
 */
const DRAW_ANGLE_STEP = 45

/**
 * How close, in screen pixels, a segment has to be to the previous one's length
 * before it latches onto it exactly.
 */
const EQUAL_LENGTH_REACH = 8

/**
 * How far a point being PLACED reaches for a guide, in screen pixels.
 *
 * Wider than a drag's, on purpose. A drag has the object under the cursor to
 * aim with; placing a point is aiming at nothing, so the guides have to come
 * and meet it.
 */
const DRAW_SNAP_REACH = 9

type ShapeDrag = DrawDrag & { node: RectNode | EllipseNode }
type DragOp = MoveDrag | ResizeDrag | RotateDrag | ShapeDrag | AnchorMoveDrag | HandleMoveDrag

interface Client {
  clientX: number
  clientY: number
}

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; last: Vec }
  | { kind: 'marquee'; originScreen: Vec; base: NodeId[]; additive: boolean }
  | { kind: 'anchorMarquee'; originScreen: Vec; base: AnchorRef[]; additive: boolean }
  | {
      kind: 'drag'
      ctx: DragContext
      op: DragOp
      originScreen: Vec
      started: boolean
      /**
       * A live shape that has to become a real path before this drag can edit
       * it. Deferred to the first movement, so merely clicking an anchor to
       * look at it does not quietly take the corner-radius field away.
       */
      convert?: NodeId
    }

export function Canvas(): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const doc = useEditor((s) => s.doc)
  const preview = useEditor((s) => s.preview)
  const selection = useEditor((s) => s.selection)
  const anchorSelection = useEditor((s) => s.anchorSelection)
  const penDraft = useEditor((s) => s.penDraft)
  const tool = useEditor((s) => s.tool)
  const viewport = useEditor((s) => s.viewport)
  const snapEnabled = useEditor((s) => s.snapEnabled)
  const gridVisible = useEditor((s) => s.gridVisible)
  const gridSize = useEditor((s) => s.gridSize)
  const guides = useEditor((s) => s.guides)
  const spacing = useEditor((s) => s.spacing)

  const shown = activeDoc({ doc, preview })
  const pathTool = isPathTool(tool)

  const [hoverId, setHoverId] = useState<NodeId | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [readout, setReadout] = useState<{ text: string; at: Vec; matched?: boolean } | null>(
    null,
  )
  const [cursor, setCursor] = useState('default')
  const [dragging, setDragging] = useState(false)
  const [ghostAt, setGhostAt] = useState<Vec | null>(null)
  const [markedAnchor, setMarkedAnchor] = useState<Vec | null>(null)

  const interaction = useRef<Interaction>({ kind: 'none' })
  const spaceHeld = useRef(false)

  /**
   * Where the canvas sits in the viewport, cached.
   *
   * getBoundingClientRect() forces a synchronous style-and-layout pass whenever
   * the DOM has been touched since the last one — and this canvas rewrites its
   * scene on every pointer move, so calling it from the move handler cost a
   * full reflow per frame. That is what made a drag feel a frame behind.
   *
   * The offset only moves when the window does, so it is read on resize and
   * once at the start of each gesture instead.
   */
  const origin = useRef({ left: 0, top: 0 })

  /* ── Size ──────────────────────────────────────────────────────────────── */

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const measure = (): void => {
      const rect = element.getBoundingClientRect()
      origin.current = { left: rect.left, top: rect.top }
      const next = { width: element.clientWidth, height: element.clientHeight }
      setSize(next)
      // Published so zoom-to-fit and the zoom control, which live elsewhere,
      // can work in screen terms without reaching for the DOM.
      useEditor.getState().setCanvasSize(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const readOrigin = useCallback((): void => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) origin.current = { left: rect.left, top: rect.top }
  }, [])

  const localPoint = useCallback(
    (event: Client): Vec => ({
      x: event.clientX - origin.current.left,
      y: event.clientY - origin.current.top,
    }),
    [],
  )

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const selectedNodes = useMemo(() => {
    const wanted = new Set(selection)
    return shown.nodes.filter((node) => wanted.has(node.id))
  }, [shown, selection])
  const frame = useMemo(() => selectionFrame(selectedNodes), [selectedNodes])

  const pathViews: PathView[] = useMemo(
    () => (pathTool ? buildPathViews(shown, selection, anchorSelection) : []),
    [anchorSelection, pathTool, selection, shown],
  )

  const ghost: DrawGhost | null = useMemo(() => {
    if (!penDraft || !ghostAt || dragging) return null
    return drawGhost(shown, penDraft, ghostAt, tool === 'curvature')
  }, [dragging, ghostAt, penDraft, shown, tool])

  const hoverQuad = useMemo(() => {
    if (pathTool || !hoverId || selection.includes(hoverId)) return null
    const node = shown.nodes.find((n) => n.id === hoverId)
    return node ? worldCorners(node) : null
  }, [hoverId, pathTool, selection, shown])

  /* ── Snapping context ──────────────────────────────────────────────────── */

  const buildContext = useCallback(
    (
      base: Doc,
      options: { exclude?: readonly NodeId[]; anchors?: readonly AnchorRef[] },
    ): DragContext => ({
      baseDoc: base,
      // Targets are collected ONCE per drag, not per move. The set cannot change
      // while a drag is running, and rebuilding it 120 times a second is the
      // difference between guides that feel instant and guides that lag.
      targets: collectTargets(base, {
        exclude: options.exclude,
        // A path tool also lines up on other anchors, which is the only way to
        // make one curve meet another exactly.
        points: options.anchors ? anchorPoints(base, options.anchors) : undefined,
      }),
      zoom: viewport.zoom,
      snapEnabled,
      grid: gridVisible ? gridSize : null,
    }),
    [gridSize, gridVisible, snapEnabled, viewport.zoom],
  )

  /**
   * The snap targets a drawing tool aims against.
   *
   * Collected once per committed change rather than on every pointer move: the
   * document cannot change between two clicks, and rebuilding the candidate
   * list at the pointer's rate is what would make the guides arrive late.
   */
  const drawContext = useMemo(
    () => (pathTool ? buildContext(doc, { anchors: [] }) : null),
    [buildContext, doc, pathTool],
  )

  /* ── Hover ─────────────────────────────────────────────────────────────── */

  const updateHover = useCallback(
    (event: Client, point: Vec, currentDoc: Doc, mods: Modifiers): void => {
      const state = useEditor.getState()
      const screen = localPoint(event)

      if (state.tool === 'hand' || spaceHeld.current) {
        setHoverId(null)
        setMarkedAnchor(null)
        setCursor('grab')
        return
      }

      if (isPathTool(state.tool)) {
        setHoverId(null)

        /*
         * The guides run while the point is still being AIMED, not only once it
         * is placed. Snapping silently on the click and showing nothing before
         * it is the same as not having guides at all: by the time you can see
         * where the point went, you have already put it there.
         */
        if (state.penDraft && drawContext) {
          const aim = aimDrawPoint(state, drawContext, point, mods)
          setGhostAt(aim.point)
          state.setGuides(aim.guides, [])
          setReadout(
            aim.readout
              ? { text: aim.readout, at: { x: screen.x + 18, y: screen.y + 22 }, matched: aim.matched }
              : null,
          )
        } else {
          setGhostAt(null)
          setReadout(null)
          if (state.guides.length > 0) state.clearGuides()
        }

        const pick = pickPath(pathViews, state.viewport, screen)
        const marked = pick?.kind === 'anchor' ? findAnchorView(pathViews, pick.ref) : null
        setMarkedAnchor(marked?.p ?? null)

        if (pick?.kind === 'handle') setCursor('crosshair')
        else if (pick?.kind === 'anchor') setCursor('pointer')
        else if (
          state.tool === 'pen' &&
          !state.penDraft &&
          pickSegment(currentDoc, state.selection, state.viewport, screen)
        ) {
          setCursor('copy')
        } else setCursor(state.tool === 'direct' ? 'default' : 'crosshair')
        return
      }

      setGhostAt(null)
      setMarkedAnchor(null)

      if (state.tool !== 'select') {
        setHoverId(null)
        setCursor('crosshair')
        return
      }

      if (frame && selection.length > 0) {
        const points = handlePoints(frame, state.viewport)
        const handle = hitHandle(points, screen)
        if (handle) {
          setCursor(handleCursor(handle, frame.rotation))
          setHoverId(null)
          return
        }
        if (hitRotateZone(points, screen)) {
          setCursor('crosshair')
          setHoverId(null)
          return
        }
      }

      const hit = hitNode(currentDoc, event, point)
      setHoverId(hit?.id ?? null)
      setCursor(hit ? 'move' : 'default')
    },
    [drawContext, frame, localPoint, pathViews, selection],
  )

  /* ── Pen and curvature ─────────────────────────────────────────────────── */

  const beginDrawClick = useCallback(
    (state: EditorState, screen: Vec, raw: Vec, mods: Modifiers): void => {
      const curvature = state.tool === 'curvature'
      const draft = state.penDraft
      const pick = pickPath(pathViews, state.viewport, screen)

      /*
       * Editing what is already on screen comes before adding to it. Both tools
       * stay usable once the path is finished — drag a point, pull a handle,
       * Alt-click to remove one — which is most of what anyone does with a path
       * after drawing it. Illustrator makes you change tools for all of that.
       */
      if (pick?.kind === 'handle') {
        const view = findAnchorView(pathViews, pick.ref)
        if (view) {
          interaction.current = {
            kind: 'drag',
            ctx: buildContext(state.doc, { anchors: [] }),
            op: {
              kind: 'handleMove',
              ref: pick.ref,
              side: pick.side,
              anchor: view.p,
              symmetric: false,
            },
            originScreen: screen,
            started: false,
            convert: pick.ref.nodeId,
          }
          return
        }
      }

      if (pick?.kind === 'anchor') {
        const view = findAnchorView(pathViews, pick.ref)
        const count = anchorCount(pathViews, pick.ref)
        if (view) {
          if (mods.alt) {
            const converted = ensurePath(state.doc, pick.ref.nodeId)
            const removed = removeAnchors(converted, [pick.ref])
            state.commit(
              curvature ? refitSubPath(removed, pick.ref.nodeId, pick.ref.subpath) : removed,
            )
            state.setAnchorSelection([])
            return
          }

          const onDraft =
            !!draft && draft.nodeId === pick.ref.nodeId && draft.subpath === pick.ref.subpath
          const isFirst = onDraft && pick.ref.index === 0 && count >= 2
          const isLast = onDraft && pick.ref.index === count - 1

          if (curvature && isLast) {
            // The point you just placed, made sharp. The pen's equivalent is
            // retracting the handle it leaves along, which penClick does below.
            const converted = ensurePath(state.doc, pick.ref.nodeId)
            state.commit(
              toggleCornerAt(converted, pick.ref.nodeId, pick.ref.subpath, pick.ref.index),
            )
            return
          }

          if (!isFirst && !isLast) {
            state.setAnchorSelection([pick.ref])
            interaction.current = {
              kind: 'drag',
              ctx: buildContext(state.doc, { anchors: [pick.ref] }),
              op: {
                kind: 'anchorMove',
                refs: [pick.ref],
                lead: view.p,
                startDoc: raw,
                refit: curvature,
              },
              originScreen: screen,
              started: false,
              convert: pick.ref.nodeId,
            }
            return
          }
          // The first or last point of the path being drawn falls through: the
          // click functions close it, or retract the handle it leaves along.
        }
      }

      // Clicking the outline of a selected path puts a point exactly there,
      // without moving the curve by so much as a pixel.
      if (!draft && !pick) {
        const segment = pickSegment(state.doc, state.selection, state.viewport, screen)
        if (segment) {
          const converted = ensurePath(state.doc, segment.nodeId)
          const inserted = insertAnchorAt(
            converted,
            segment.nodeId,
            segment.subpath,
            segment.segment,
            segment.t,
          )
          state.commit(
            curvature ? refitSubPath(inserted, segment.nodeId, segment.subpath) : inserted,
          )
          return
        }
      }

      // The same aim the hover preview just drew, so the point lands exactly
      // where the ghost said it would.
      const ctx = drawContext ?? buildContext(state.doc, { anchors: [] })
      const { point } = aimDrawPoint(state, ctx, raw, mods)

      const click = curvature ? curvatureClick : penClick
      const result = click({
        doc: state.doc,
        layer: state.activeLayer,
        draft,
        point,
        onAnchor: pick?.kind === 'anchor' ? pick.ref : null,
      })

      // Each placed point is its own undo step, so Ctrl+Z during a stroke takes
      // back the last point rather than the whole path.
      state.commit(result.doc)
      state.setSelection(result.selection)
      state.setPenDraft(result.draft)
      state.setAnchorSelection([])
      setGhostAt(point)

      if (!result.handle) return
      interaction.current = {
        kind: 'drag',
        ctx: buildContext(result.doc, { anchors: [] }),
        op: {
          kind: 'handleMove',
          ref: result.handle.ref,
          side: 'out',
          anchor: result.handle.anchor,
          symmetric: true,
        },
        originScreen: screen,
        started: false,
      }
    },
    [buildContext, drawContext, pathViews],
  )

  /* ── Direct select ─────────────────────────────────────────────────────── */

  const beginDirectClick = useCallback(
    (state: EditorState, client: Client, screen: Vec, point: Vec, mods: Modifiers): void => {
      const pick = pickPath(pathViews, state.viewport, screen)

      if (pick?.kind === 'handle') {
        const anchor = findAnchorView(pathViews, pick.ref)
        if (!anchor) return
        interaction.current = {
          kind: 'drag',
          ctx: buildContext(state.doc, { anchors: [] }),
          op: {
            kind: 'handleMove',
            ref: pick.ref,
            side: pick.side,
            anchor: anchor.p,
            symmetric: false,
          },
          originScreen: screen,
          started: false,
          convert: pick.ref.nodeId,
        }
        return
      }

      if (pick?.kind === 'anchor') {
        const anchor = findAnchorView(pathViews, pick.ref)
        if (!anchor) return
        let refs = state.anchorSelection
        if (mods.shift) {
          state.toggleAnchorSelection(pick.ref)
          refs = useEditor.getState().anchorSelection
        } else if (!refs.some((r) => sameAnchor(r, pick.ref))) {
          refs = [pick.ref]
          state.setAnchorSelection(refs)
        }
        if (refs.length === 0) return

        interaction.current = {
          kind: 'drag',
          ctx: buildContext(state.doc, { anchors: refs }),
          op: { kind: 'anchorMove', refs: [...refs], lead: anchor.p, startDoc: point },
          originScreen: screen,
          started: false,
          convert: pick.ref.nodeId,
        }
        return
      }

      if (pickSegment(state.doc, state.selection, state.viewport, screen)) {
        // Clicking the outline keeps the path selected and drops the anchor
        // selection — how you get every point back on screen after working on
        // one of them.
        state.setAnchorSelection([])
        return
      }

      const hit = hitNode(state.doc, client, point)
      if (hit) {
        state.setSelection([hit.id])
        state.setAnchorSelection([])
        return
      }

      // Empty space rubber-bands the anchors of whatever is being edited, and
      // falls back to picking whole objects when nothing is.
      if (state.selection.length > 0) {
        if (!mods.shift) state.setAnchorSelection([])
        interaction.current = {
          kind: 'anchorMarquee',
          originScreen: screen,
          base: mods.shift ? state.anchorSelection : [],
          additive: mods.shift,
        }
        return
      }
      state.clearSelection()
      interaction.current = { kind: 'marquee', originScreen: screen, base: [], additive: false }
    },
    [buildContext, pathViews],
  )

  /* ── Pointer down ──────────────────────────────────────────────────────── */

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button === 2) return
      const element = containerRef.current
      if (!element) return
      element.setPointerCapture(event.pointerId)
      element.focus()
      readOrigin()

      const screen = localPoint(event)
      const point = screenToDoc(viewport, screen)
      const state = useEditor.getState()
      const mods = modifiersOf(event)

      // Middle button, the hand tool and a held space all mean the same thing.
      if (event.button === 1 || tool === 'hand' || spaceHeld.current) {
        interaction.current = { kind: 'pan', last: screen }
        setCursor('grabbing')
        return
      }

      if (tool === 'pen' || tool === 'curvature') {
        beginDrawClick(state, screen, point, mods)
        return
      }

      if (tool === 'direct') {
        beginDirectClick(state, event, screen, point, mods)
        return
      }

      if (tool === 'rect' || tool === 'ellipse') {
        const shape = { layer: state.activeLayer, x: point.x, y: point.y, width: 0, height: 0 }
        const node = tool === 'rect' ? createRect(shape) : createEllipse(shape)
        interaction.current = {
          kind: 'drag',
          ctx: buildContext(state.doc, {}),
          op: { kind: 'draw', shape: tool, startDoc: point, node },
          originScreen: screen,
          started: false,
        }
        state.setPreview(addNodes(state.doc, [node]))
        return
      }

      // Select tool. Handles come first: they sit on top of everything.
      if (frame && selection.length > 0) {
        const points = handlePoints(frame, viewport)
        const handle = hitHandle(points, screen)
        if (handle) {
          const resize = beginResize(state.doc, selection, handle)
          if (resize) {
            interaction.current = {
              kind: 'drag',
              ctx: buildContext(state.doc, { exclude: selection }),
              op: resize,
              originScreen: screen,
              started: false,
            }
            return
          }
        }
        if (hitRotateZone(points, screen)) {
          const pivot = rectCenter(frame.bounds)
          interaction.current = {
            kind: 'drag',
            ctx: buildContext(state.doc, { exclude: selection }),
            op: {
              kind: 'rotate',
              ids: selection,
              pivot,
              startAngle: angleTo(pivot, point),
              startRotation: frame.rotation,
            },
            originScreen: screen,
            started: false,
          }
          return
        }
      }

      const hit = hitNode(state.doc, event, point)

      if (!hit) {
        if (!mods.shift) state.clearSelection()
        interaction.current = {
          kind: 'marquee',
          originScreen: screen,
          base: mods.shift ? selection : [],
          additive: mods.shift,
        }
        return
      }

      let ids = selection
      if (mods.shift) {
        ids = selection.includes(hit.id)
          ? selection.filter((id) => id !== hit.id)
          : [...selection, hit.id]
        state.setSelection(ids)
      } else if (!selection.includes(hit.id)) {
        ids = [hit.id]
        state.setSelection(ids)
      }
      if (ids.length === 0) return

      const wanted = new Set(ids)
      const movingFrame = selectionFrame(state.doc.nodes.filter((n) => wanted.has(n.id)))
      if (!movingFrame) return
      interaction.current = {
        kind: 'drag',
        ctx: buildContext(state.doc, { exclude: ids }),
        op: { kind: 'move', ids, startDoc: point, startBounds: movingFrame.bounds },
        originScreen: screen,
        started: false,
      }
    },
    [
      beginDirectClick,
      beginDrawClick,
      buildContext,
      frame,
      localPoint,
      readOrigin,
      selection,
      tool,
      viewport,
    ],
  )

  /* ── Pointer move ──────────────────────────────────────────────────────── */

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const current = interaction.current
      const state = useEditor.getState()
      const screen = localPoint(event)
      const point = screenToDoc(state.viewport, screen)
      const mods = modifiersOf(event)

      if (current.kind === 'pan') {
        state.setViewport(
          panBy(state.viewport, screen.x - current.last.x, screen.y - current.last.y),
        )
        current.last = screen
        return
      }

      if (current.kind === 'marquee') {
        setMarquee(rectFromCorners(current.originScreen, screen))
        const docRect = rectFromCorners(screenToDoc(state.viewport, current.originScreen), point)
        const caught = hitMarquee(state.doc, docRect)
        state.setSelection(
          current.additive
            ? [...current.base, ...caught.filter((id) => !current.base.includes(id))]
            : caught,
        )
        return
      }

      if (current.kind === 'anchorMarquee') {
        setMarquee(rectFromCorners(current.originScreen, screen))
        const docRect = rectFromCorners(screenToDoc(state.viewport, current.originScreen), point)
        const caught = anchorsInRect(pathViews, docRect)
        state.setAnchorSelection(
          current.additive
            ? [
                ...current.base,
                ...caught.filter((r) => !current.base.some((b) => sameAnchor(b, r))),
              ]
            : caught,
        )
        return
      }

      if (current.kind === 'none') {
        updateHover(event, point, state.doc, mods)
        return
      }

      if (!current.started) {
        const travelled = Math.hypot(
          screen.x - current.originScreen.x,
          screen.y - current.originScreen.y,
        )
        if (travelled < DRAG_THRESHOLD) return
        current.started = true
        setDragging(true)

        // The live shape becomes a real path now that it is actually being
        // edited, as its own undo step before the drag builds on it.
        if (current.convert) {
          const converted = ensurePath(state.doc, current.convert)
          current.convert = undefined
          if (converted !== state.doc) {
            state.commit(converted)
            current.ctx = { ...current.ctx, baseDoc: converted }
          }
        }
      }

      const at = { x: screen.x + 18, y: screen.y + 22 }

      if (current.op.kind === 'draw') {
        const out = stepDraw(current.ctx, current.op, point, mods)
        state.setPreview(addNodes(current.ctx.baseDoc, [shapeWithRect(current.op, out.rect)]))
        state.setGuides(out.guides, [])
        setReadout({ text: out.readout, at })
        return
      }

      const out = stepFor(current.ctx, current.op, point, mods)
      state.setPreview(out.doc)
      state.setGuides(out.guides, out.spacing)
      setReadout(out.readout ? { text: out.readout, at } : null)
    },
    [localPoint, pathViews, updateHover],
  )

  const endInteraction = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    containerRef.current?.releasePointerCapture(event.pointerId)
    const current = interaction.current
    const state = useEditor.getState()
    interaction.current = { kind: 'none' }
    setMarquee(null)
    setReadout(null)
    setDragging(false)

    if (current.kind === 'pan') {
      setCursor(state.tool === 'hand' ? 'grab' : 'default')
      return
    }
    if (current.kind !== 'drag') return

    if (current.op.kind === 'draw') {
      const id = current.op.node.id
      const drawn = state.preview?.nodes.find((n) => n.id === id)
      // A click with a shape tool is a click, not a zero-sized rectangle.
      if (!current.started || !drawn) {
        state.setPreview(null)
        state.clearGuides()
        return
      }
      state.commitPreview()
      state.setSelection([id])
      state.setTool('select')
      return
    }

    state.commitPreview()
  }, [])

  /** Curvature: a double click flips a point between smooth and sharp. */
  const onDoubleClick = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const state = useEditor.getState()
      if (state.tool === 'curvature') {
        const pick = pickPath(pathViews, state.viewport, localPoint(event))
        if (pick?.kind === 'anchor') {
          const converted = ensurePath(state.doc, pick.ref.nodeId)
          state.commit(toggleCornerAt(converted, pick.ref.nodeId, pick.ref.subpath, pick.ref.index))
          return
        }
      }
      if (state.penDraft) state.finishDrawing()
    },
    [localPoint, pathViews],
  )

  /* ── Wheel ─────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    // Registered by hand because React's own wheel listener is passive, and a
    // passive listener cannot stop the page scrolling under the canvas.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const state = useEditor.getState()
      const at = {
        x: event.clientX - origin.current.left,
        y: event.clientY - origin.current.top,
      }

      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.0035)
        state.setViewport(zoomAt(state.viewport, at, state.viewport.zoom * factor))
        return
      }
      const dx = event.shiftKey ? -event.deltaY : -event.deltaX
      const dy = event.shiftKey ? 0 : -event.deltaY
      state.setViewport(panBy(state.viewport, dx, dy))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  /* ── Space to pan ──────────────────────────────────────────────────────── */

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat || isTyping(event.target)) return
      spaceHeld.current = true
      if (interaction.current.kind === 'none') setCursor('grab')
    }
    const up = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return
      // No isTyping check on the way up: the field may have lost focus while
      // the key was down, and a space that is never released leaves the canvas
      // stuck in pan mode.
      spaceHeld.current = false
      if (interaction.current.kind === 'none') setCursor('default')
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  /* ── Render ────────────────────────────────────────────────────────────── */

  const ready = size.width > 0 && size.height > 0
  const showGrid = gridVisible && gridSize * viewport.zoom >= 4

  /*
   * The artboard's drop shadow, as a plain element behind the scene.
   *
   * It used to be `filter: drop-shadow()` on the SVG rect, which re-blurred the
   * whole page every time any shape moved — the scene repaints as a unit, so a
   * filter inside it is paid for on every frame of every drag. A box-shadow on
   * an element that does not change during a drag is cached by the compositor
   * and costs nothing until the view actually pans or zooms.
   */
  const paper = docRectToScreen(viewport, {
    x: 0,
    y: 0,
    width: shown.artboard.width,
    height: shown.artboard.height,
  })

  return (
    <div
      ref={containerRef}
      className="gv-canvas"
      style={{ cursor }}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onDoubleClick={onDoubleClick}
      onPointerLeave={() => {
        if (interaction.current.kind !== 'none') return
        // Everything the hover was showing goes with the pointer. A guide left
        // behind on an empty canvas is a claim about a cursor that is not there.
        setHoverId(null)
        setGhostAt(null)
        setReadout(null)
        setMarkedAnchor(null)
        if (useEditor.getState().guides.length > 0) useEditor.getState().clearGuides()
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {ready && (
        <>
          <div
            className="gv-paper"
            style={{ left: paper.x, top: paper.y, width: paper.width, height: paper.height }}
          />
          <svg
            className="gv-scene"
            width={size.width}
            height={size.height}
            viewBox={viewBoxOf(viewport, size)}
          >
            <Scene doc={shown}>
              {showGrid && <Grid viewport={viewport} size={size} pitch={gridSize} />}
            </Scene>
          </svg>

          <Overlay
            size={size}
            viewport={viewport}
            /* A path tool replaces the bounding box with the anchor skeleton.
               Showing both at once is what makes Illustrator's direct selection
               so hard to read. */
            frame={pathTool ? null : frame}
            hover={hoverQuad}
            guides={guides}
            spacing={spacing}
            marquee={marquee}
            readout={readout}
            /* Handles are hidden mid-drag: the guides are what matters then,
               and eight squares sitting on top of them is noise. */
            showHandles={!dragging}
            paths={pathViews}
            ghost={ghost}
            markedAnchor={markedAnchor}
          />
        </>
      )}
    </div>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function modifiersOf(event: {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): Modifiers {
  return { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey || event.metaKey }
}

interface DrawAim {
  /** Where the point will actually land. */
  point: Vec
  guides: Guide[]
  readout: string | null
  /** True when the length matched the previous segment's. */
  matched: boolean
}

/**
 * Where the next point goes, and what to show about it.
 *
 * The hover preview and the click BOTH go through this, which is the only way
 * the ghost can be trusted: anything the click decides on its own is something
 * the preview did not show.
 *
 * Three things can move the point, in this order, and only one of them wins:
 *
 *  1. Shift constrains the direction from the LAST POINT PLACED, so a straight
 *     run continues from where the path already is.
 *  2. The ordinary snap, against every edge, centre and anchor in the document.
 *  3. Equal length to the previous segment — only when nothing else latched,
 *     because a snapped point and a snapped length pull different ways.
 */
function aimDrawPoint(
  state: EditorState,
  ctx: DragContext,
  raw: Vec,
  mods: Modifiers,
): DrawAim {
  const draft = state.penDraft
  const last = draft ? lastAnchorWorld(state.doc, draft) : null
  const snapping = ctx.snapEnabled && !mods.ctrl

  let point = raw
  let guides: Guide[] = []

  if (mods.shift && last) {
    /*
     * Shift fixes the DIRECTION, so the snap gets to choose the distance and
     * nothing else. An ordinary two-axis snap here would pull the point off the
     * ray — the one thing the constraint was asked to guarantee — which is why
     * it used to be switched off entirely and why holding Shift felt like
     * losing the guides.
     */
    point = constrainAngle(last, raw, DRAW_ANGLE_STEP)
    const away = { x: point.x - last.x, y: point.y - last.y }
    const reach = Math.hypot(away.x, away.y)
    if (snapping && reach > 1e-6) {
      const direction = { x: away.x / reach, y: away.y / reach }
      const along = snapAlongRay({
        origin: last,
        direction,
        distance: reach,
        targets: ctx.targets,
        zoom: ctx.zoom,
        threshold: DRAW_SNAP_REACH,
      })
      if (along) {
        point = {
          x: last.x + direction.x * along.distance,
          y: last.y + direction.y * along.distance,
        }
        guides = along.guides
      }
    }
  } else if (snapping) {
    const snap = snapBounds({
      bounds: { x: point.x, y: point.y, width: 0, height: 0 },
      targets: ctx.targets,
      zoom: ctx.zoom,
      grid: ctx.grid,
      threshold: DRAW_SNAP_REACH,
      refs: { x: ['min'], y: ['min'] },
      spacing: false,
    })
    point = { x: point.x + snap.dx, y: point.y + snap.dy }
    guides = snap.guides
  }

  if (!last || !draft) return { point, guides, readout: null, matched: false }

  let length = Math.hypot(point.x - last.x, point.y - last.y)
  let matched = false
  const previous = previousSegmentLength(state.doc, draft)
  if (previous && snapping && guides.length === 0 && length > 1e-6) {
    if (Math.abs(length - previous) * ctx.zoom <= EQUAL_LENGTH_REACH) {
      const k = previous / length
      point = { x: last.x + (point.x - last.x) * k, y: last.y + (point.y - last.y) * k }
      length = previous
      matched = true
    }
  }

  const degrees = (Math.atan2(point.y - last.y, point.x - last.x) * 180) / Math.PI
  return { point, guides, readout: `${round(length, 1)} · ${round(degrees, 1)}°`, matched }
}

function anchorCount(views: readonly PathView[], ref: AnchorRef): number {
  return views.find((v) => v.nodeId === ref.nodeId)?.subpaths[ref.subpath]?.anchors.length ?? 0
}

function findAnchorView(views: readonly PathView[], ref: AnchorRef): AnchorView | null {
  for (const view of views) {
    for (const sp of view.subpaths) {
      for (const anchor of sp.anchors) {
        if (sameAnchor(anchor.ref, ref)) return anchor
      }
    }
  }
  return null
}

function stepFor(ctx: DragContext, op: DragOp, point: Vec, mods: Modifiers): DragOutput {
  switch (op.kind) {
    case 'move':
      return stepMove(ctx, op, point, mods)
    case 'resize':
      return stepResize(ctx, op, point, mods)
    case 'rotate':
      return stepRotate(ctx, op, point, mods)
    case 'anchorMove':
      return stepAnchorMove(ctx, op, point, mods)
    case 'handleMove':
      return stepHandleMove(ctx, op, point, mods)
    case 'draw':
      // Handled before this point: a draw builds a node rather than editing one.
      return { doc: ctx.baseDoc, guides: [], spacing: [], readout: null }
  }
}

/**
 * The node being drawn, resized to the rectangle the drag describes.
 *
 * The node itself is made once at pointer-down and only its box changes, so the
 * id — and with it React's element and the DOM node — survives the whole drag.
 */
function shapeWithRect(drag: ShapeDrag, rect: Rect): RectNode | EllipseNode {
  return { ...drag.node, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/**
 * The grid, drawn in the scene's own space and under the artwork.
 *
 * Only the lines actually on screen are emitted. An SVG <pattern> would be
 * shorter, but it tiles in user units and turns into moire the moment the zoom
 * pushes the pitch below a pixel.
 */
function Grid({
  viewport,
  size,
  pitch,
}: {
  viewport: Viewport
  size: { width: number; height: number }
  pitch: number
}): ReactElement {
  const left = viewport.x
  const top = viewport.y
  const right = viewport.x + size.width / viewport.zoom
  const bottom = viewport.y + size.height / viewport.zoom

  const lines: ReactElement[] = []
  const strokeWidth = 1 / viewport.zoom
  for (let x = Math.ceil(left / pitch) * pitch; x <= right; x += pitch) {
    lines.push(<line key={`x${x}`} x1={x} y1={top} x2={x} y2={bottom} strokeWidth={strokeWidth} />)
  }
  for (let y = Math.ceil(top / pitch) * pitch; y <= bottom; y += pitch) {
    lines.push(<line key={`y${y}`} x1={left} y1={y} x2={right} y2={y} strokeWidth={strokeWidth} />)
  }
  return <g className="gv-grid">{lines}</g>
}
