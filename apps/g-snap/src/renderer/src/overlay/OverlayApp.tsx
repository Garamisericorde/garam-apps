import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Group,
  Image as KonvaImage,
  Layer,
  Rect as KonvaRect,
  Shape as KonvaShape,
  Stage,
  Text,
} from 'react-konva'
import Konva from 'konva'
import { mixHex, palette, violetAccent } from '@garam/theme'
import type { CommitRequest, Rect } from '@shared/types'
import { useOverlay, textFontSize } from './store'
import { buildComposite, type Composite } from './composite'
import { renderShape, isMeaningful } from './Shapes'
import { ToolPanel, TOOL_SHORTCUTS } from './ToolPanel'
import { ActionBar } from './ActionBar'
import { CursorReadout } from './CursorReadout'
import { appendPoint, boxFrom, segmentTo, smoothStroke, type Modifiers } from './strokes'
import { setLocale, t } from '@shared/i18n/index.js'
import {
  clampRect,
  HANDLES,
  HANDLE_ANCHOR,
  HANDLE_CURSOR,
  MIN_SELECTION_SIZE,
  pointInRect,
  rectFromPoints,
  type HandleId,
  type Point,
  type Shape,
} from './types'

const HANDLE_SIZE = 8
const HANDLE_HIT = 12

/**
 * Device pixels per CSS pixel, captured once.
 *
 * Every scaling decision in this file runs through this number. The stage is
 * sized so that `cssSize * DPR` lands on a whole device pixel, which is what
 * keeps the frozen screenshot pixel-exact on screen.
 */
const DPR = window.devicePixelRatio || 1

// Konva defaults to devicePixelRatio anyway; pinning it makes the contract
// explicit and immune to a Konva version changing that default.
Konva.pixelRatio = DPR

type Drag =
  /**
   * `autoCopy`: Ctrl was held when the drag began. The moment the mouse is
   * released the selection is copied and the overlay closes — Lightshot's
   * quick-copy flow. Ctrl is read at MOUSEDOWN time; releasing it mid-drag
   * does not change the decision.
   */
  | { kind: 'new'; start: Point; autoCopy: boolean }
  | { kind: 'move'; start: Point; origin: Rect }
  | { kind: 'resize'; handle: HandleId; origin: Rect }
  /**
   * `last`: the most recent pointer position, kept so the shape can be rebuilt
   * when Shift or Alt is pressed WITHOUT the mouse moving. Without it the
   * modifier appears to do nothing until the user jiggles the mouse.
   */
  | { kind: 'draw'; start: Point; last: Point }
  | null

export function OverlayApp() {
  const [composite, setComposite] = useState<Composite | null>(null)
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 })
  const [hoverHandle, setHoverHandle] = useState<HandleId | null>(null)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  /**
   * Mirrors dragRef into state. The toolbars must not cover the area being
   * selected, so they only appear once the mouse is released — but dragRef is a
   * ref and does not re-render, hence this.
   */
  const [dragging, setDragging] = useState(false)

  const dragRef = useRef<Drag>(null)
  /** True while the frame on screen is the startup warm-up, not a capture. */
  const warmupRef = useRef(false)
  const stageRef = useRef<Konva.Stage>(null)
  const dimLayerRef = useRef<Konva.Layer>(null)
  const annoLayerRef = useRef<Konva.Layer>(null)
  const uiLayerRef = useRef<Konva.Layer>(null)
  const textInputRef = useRef<HTMLTextAreaElement>(null)

  const store = useOverlay()
  const { phase, selection, color, sizes, shapes, draft, textDraft, stage, origin } = store

  // ── Init payload from the main process ─────────────────────────────────

  useEffect(() => {
    return window.api.overlay.onInit((payload) => {
      // Before any state update, so the render that follows is already in the
      // right language.
      setLocale(payload.language)

      useOverlay.getState().reset({
        origin: { x: payload.union.x, y: payload.union.y },
        color: payload.defaults.color,
        thickness: payload.defaults.thickness,
      })

      // This window is never destroyed, so everything below survived the last
      // capture and would be shown for a frame before the first real event
      // corrected it — the readout visibly appearing at the old position first.
      warmupRef.current = payload.warmup === true
      setCursor(payload.cursor)
      setHoverHandle(null)
      setCtrlHeld(false)

      // Build the canvas here rather than in an effect: `payload.shots` holds
      // ~14 MB of raw pixels per display, and it must not be parked in React
      // state for the lifetime of this long-lived window.
      void buildComposite(payload.shots, payload.union)
        .then((next) => {
          if (next) setComposite(next)
        })
        .catch((err) => console.error('[overlay] could not build the composite', err))
    })
  }, [])

  // Wipe the canvas the moment the overlay is put away.
  //
  // The window is never destroyed, so it keeps its last painted surface, and
  // that surface is what can be presented for an instant on the next reveal —
  // with the readout still sitting exactly where the previous capture left it.
  // Clearing here makes the resting state plain black: a stale present then
  // shows nothing rather than something wrong, and ~14 MB of pixels are not
  // held for the hours this tray app spends idle.
  useEffect(() => {
    return window.api.overlay.onClear(() => {
      setComposite(null)
      useOverlay.getState().resetSelection()
    })
  }, [])

  /**
   * Stage size in CSS pixels, derived from the DEVICE size rather than from the
   * display's DIP bounds.
   *
   * This is the whole fix for the blurry overlay. `display.bounds.width` is a
   * rounded DIP value (2319), so a stage that wide gets a 2560-pixel backing
   * store painted into a 2560.56-device-pixel box — the browser then rescales
   * by 0.02% and every edge softens (measured: 25% of edge contrast lost).
   * Sizing from `deviceWidth / DPR` instead makes the two match exactly.
   */
  const stageSize = useMemo(() => {
    if (!composite) return null
    // Konva does `canvas.width = cssSize * pixelRatio`, and assigning to
    // canvas.width TRUNCATES. Floating point can leave that product a hair
    // under the target (2559.9999... -> 2559), which would cost a column of
    // pixels and reintroduce a fractional scale. The epsilon makes it err high
    // so truncation always lands on the intended integer; it is a millionth of
    // a CSS pixel and changes nothing visible.
    const EPS = 1e-6
    return {
      width: composite.deviceWidth / DPR + EPS,
      height: composite.deviceHeight / DPR + EPS,
    }
  }, [composite])

  // Publish the stage size, then let the main process show the window.
  //
  // Waiting two animation frames matters: the first schedules the paint, the
  // second runs after it has been committed. Reporting ready any earlier shows
  // a window that has not drawn yet, which is exactly the blank flash.
  useEffect(() => {
    if (!stageSize) return
    useOverlay.getState().setStage(stageSize)

    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (warmupRef.current) {
          // The warm-up frame has now been through every stage that used to be
          // cold. Drop it: nothing is shown, and ~14 MB per display is not held
          // for the lifetime of a tray app.
          warmupRef.current = false
          setComposite(null)
          return
        }
        void window.api.overlay.ready()
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [stageSize])

  // ── Helpers ────────────────────────────────────────────────────────────

  const stageBounds = useMemo<Rect>(
    () => ({ x: 0, y: 0, width: stage.width, height: stage.height }),
    [stage.width, stage.height],
  )

  /**
   * Derives the pointer position from the NATIVE event.
   *
   * Konva's `getPointerPosition()` is only updated on a pointer event. When the
   * overlay opens from a hotkey there has been no movement inside the window
   * yet, so on the first mousedown that value is still (0,0) and the selection
   * starts from the top-left corner. The event's own coordinates are always
   * correct.
   */
  const pointerFrom = useCallback((evt: MouseEvent): Point => {
    const box = stageRef.current?.container()?.getBoundingClientRect()
    return {
      x: evt.clientX - (box?.left ?? 0),
      y: evt.clientY - (box?.top ?? 0),
    }
  }, [])

  const hitHandle = useCallback(
    (p: Point): HandleId | null => {
      if (!selection) return null
      for (const id of HANDLES) {
        const a = HANDLE_ANCHOR[id]
        const hx = selection.x + selection.width * a.x
        const hy = selection.y + selection.height * a.y
        if (Math.abs(p.x - hx) <= HANDLE_HIT / 2 && Math.abs(p.y - hy) <= HANDLE_HIT / 2) {
          return id
        }
      }
      return null
    },
    [selection],
  )

  const cancel = useCallback(() => {
    void window.api.overlay.cancel()
  }, [])

  // ── Export ─────────────────────────────────────────────────────────────

  /**
   * Renders the selection at true device resolution with NOTHING resampled.
   *
   * The old path handed Konva a crop rectangle in CSS units and let it scale.
   * Because `selX * DPR` is not a whole number at fractional DPI, the whole
   * image landed on a sub-pixel offset and every edge blurred — measured at 192
   * of 255 edge contrast, and the same 192 even when the scale was exactly 1:1,
   * which proved the offset alone was the culprit.
   *
   * Now the crop is computed in whole device pixels and copied with a plain
   * `drawImage`, so the screenshot pixels pass through untouched (measured 255,
   * identical to the source). Annotations are re-rendered at device resolution
   * on top, which is a fresh vector draw rather than a resample.
   */
  const renderSelection = useCallback(
    (sel: Rect): HTMLCanvasElement | null => {
      if (!composite) return null

      // Snap to whole device pixels — this is what keeps the copy exact.
      const sx = Math.round(sel.x * DPR)
      const sy = Math.round(sel.y * DPR)
      const sw = Math.round(sel.width * DPR)
      const sh = Math.round(sel.height * DPR)
      if (sw < 1 || sh < 1) return null

      const out = document.createElement('canvas')
      out.width = sw
      out.height = sh
      const ctx = out.getContext('2d')
      if (!ctx) return null

      // 1. Screenshot: a straight integer-to-integer pixel copy.
      ctx.drawImage(composite.canvas, sx, sy, sw, sh, 0, 0, sw, sh)

      // 2. Annotations: redrawn at device resolution, then cropped the same way.
      const annoLayer = annoLayerRef.current
      if (annoLayer && useOverlay.getState().shapes.length > 0) {
        const annoCanvas = annoLayer.toCanvas({
          x: 0,
          y: 0,
          width: stage.width,
          height: stage.height,
          pixelRatio: DPR,
        })
        ctx.drawImage(annoCanvas, sx, sy, sw, sh, 0, 0, sw, sh)
      }

      return out
    },
    [composite, stage.width, stage.height],
  )

  const commit = useCallback(
    async (action: CommitRequest['action']) => {
      const sel = useOverlay.getState().selection
      if (!sel || busy) return

      // Commit any text still being typed.
      useOverlay.getState().commitText()

      setBusy(true)
      try {
        const canvas = renderSelection(sel)
        if (!canvas) return

        await window.api.overlay.commit({
          dataUrl: canvas.toDataURL('image/png'),
          rect: {
            x: Math.round(sel.x + origin.x),
            y: Math.round(sel.y + origin.y),
            width: canvas.width,
            height: canvas.height,
          },
          action,
        })
      } catch (err) {
        console.error('[overlay] export failed', err)
      } finally {
        setBusy(false)
      }
    },
    [busy, origin, renderSelection],
  )

  // ── Keyboard ───────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Do not let shortcuts fire while text is being typed.
      const typing = document.activeElement === textInputRef.current
      const s = useOverlay.getState()

      if (e.key === 'Escape') {
        e.preventDefault()
        if (s.textDraft) {
          s.cancelText()
        } else if (s.selection) {
          s.resetSelection()
        } else {
          cancel()
        }
        return
      }

      if (typing) return

      const ctrl = e.ctrlKey || e.metaKey

      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }

      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        s.redo()
        return
      }

      if (ctrl && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void commit('copy')
        return
      }

      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void commit(e.shiftKey ? 'save-as' : 'save')
        return
      }

      if (e.key === 'Enter' && s.selection) {
        e.preventDefault()
        void commit('copy')
        return
      }

      // Select the whole screen
      if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        s.setSelection({ ...stageBounds })
        return
      }

      if (!ctrl && !e.altKey) {
        const mapped = TOOL_SHORTCUTS[e.key.toLowerCase()]
        if (mapped) {
          e.preventDefault()
          s.setTool(mapped)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancel, commit, stageBounds])

  // Shift and Alt change the shape being drawn, and both are routinely pressed
  // AFTER the drag has started, without the mouse moving. Rebuilding from the
  // last known pointer position is what makes the key itself do something —
  // otherwise the modifier appears dead until the mouse is jiggled.
  useEffect(() => {
    const reapply = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' && e.key !== 'Alt') return

      const drag = dragRef.current
      if (!drag || drag.kind !== 'draw') return

      // Alt on its own activates the window menu on Windows and takes focus
      // with it, which would abandon the drag.
      if (e.key === 'Alt') e.preventDefault()

      const s = useOverlay.getState()
      if (!s.draft) return
      s.setDraft(extendShape(s.draft, drag.start, drag.last, modifiersOf(e)))
    }

    window.addEventListener('keydown', reapply)
    window.addEventListener('keyup', reapply)
    return () => {
      window.removeEventListener('keydown', reapply)
      window.removeEventListener('keyup', reapply)
    }
  }, [])

  // Focus the text input as soon as it appears.
  useEffect(() => {
    if (textDraft) textInputRef.current?.focus()
  }, [textDraft])

  // Track whether Ctrl is held so the hint can say what will happen before the
  // user even starts dragging.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(true)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(false)
    }
    // A keyup may never arrive if the window loses focus; reset the state.
    const onBlur = () => setCtrlHeld(false)

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // ── Pointer events ─────────────────────────────────────────────────────

  const onMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (busy) return

      // Right-click always cancels (matching Lightshot).
      if (e.evt.button === 2) {
        const s = useOverlay.getState()
        if (s.selection) s.resetSelection()
        else cancel()
        return
      }
      if (e.evt.button !== 0) return

      const p = pointerFrom(e.evt)
      const s = useOverlay.getState()

      // Clicking elsewhere while typing commits the text.
      if (s.textDraft) {
        s.commitText()
        return
      }

      if (!s.selection) {
        dragRef.current = { kind: 'new', start: p, autoCopy: e.evt.ctrlKey }
        setDragging(true)
        return
      }

      const handle = hitHandle(p)
      if (handle) {
        dragRef.current = { kind: 'resize', handle, origin: s.selection }
        setDragging(true)
        return
      }

      const inside = pointInRect(p, s.selection)

      if (inside && s.tool !== 'none') {
        if (s.tool === 'text') {
          s.startText(p.x, p.y)
          return
        }
        dragRef.current = { kind: 'draw', start: p, last: p }
        setDragging(true)
        s.setDraft(createShape(s.tool, p, s.color, s.sizes[s.tool]))
        return
      }

      if (inside) {
        dragRef.current = { kind: 'move', start: p, origin: s.selection }
        setDragging(true)
        return
      }

      // Clicking outside the selection starts a new one.
      s.resetSelection()
      dragRef.current = { kind: 'new', start: p, autoCopy: e.evt.ctrlKey }
      setDragging(true)
    },
    [busy, cancel, hitHandle, pointerFrom],
  )

  const onMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const p = pointerFrom(e.evt)
      setCursor(p)

      const drag = dragRef.current
      const s = useOverlay.getState()

      if (!drag) {
        setHoverHandle(s.selection ? hitHandle(p) : null)
        return
      }

      switch (drag.kind) {
        case 'new':
          s.setSelection(clampRect(rectFromPoints(drag.start, p), stageBounds))
          break

        case 'move': {
          const moved = {
            ...drag.origin,
            x: drag.origin.x + (p.x - drag.start.x),
            y: drag.origin.y + (p.y - drag.start.y),
          }
          s.setSelection(clampRect(moved, stageBounds))
          break
        }

        case 'resize':
          s.setSelection(clampRect(resizeRect(drag.origin, drag.handle, p), stageBounds))
          break

        case 'draw': {
          if (!s.draft || !s.selection) break
          // Keep drawing inside the selection.
          const c = clampPoint(p, s.selection)
          drag.last = c
          s.setDraft(extendShape(s.draft, drag.start, c, modifiersOf(e.evt)))
          break
        }
      }
    },
    [hitHandle, pointerFrom, stageBounds],
  )

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (!drag) return

    const s = useOverlay.getState()

    if (drag.kind === 'new' && s.selection) {
      // A tiny selection counts as an accidental click.
      if (s.selection.width < MIN_SELECTION_SIZE || s.selection.height < MIN_SELECTION_SIZE) {
        s.setSelection(null)
      } else if (drag.autoCopy) {
        // Drag started with Ctrl held: copy straight to the clipboard.
        void commit('copy')
      }
    }

    if (drag.kind === 'draw') {
      if (s.draft && isMeaningful(s.draft)) {
        // Thin the path before it is kept: the spline can only smooth what it
        // is not forced to pass through.
        s.setDraft(finishShape(s.draft))
        s.commitDraft()
      } else s.setDraft(null)
    }
  }, [commit])

  // Do not leave a drag hanging if the mouse is released outside the window.
  useEffect(() => {
    const onWindowUp = () => onMouseUp()
    window.addEventListener('mouseup', onWindowUp)
    return () => window.removeEventListener('mouseup', onWindowUp)
  }, [onMouseUp])

  // ── Render ─────────────────────────────────────────────────────────────

  if (!composite || !stageSize) {
    return <div className="snap-overlay snap-overlay--loading" />
  }

  const cursorClass = hoverHandle ? '' : 'is-crosshair'
  const cursorStyle = hoverHandle ? HANDLE_CURSOR[hoverHandle] : undefined

  return (
    <div className={`snap-overlay ${cursorClass}`} style={{ cursor: cursorStyle }}>
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        {/* Frozen screenshot — one composite canvas, drawn 1:1 with the screen */}
        <Layer listening={false}>
          <KonvaImage
            image={composite.canvas}
            x={0}
            y={0}
            width={stageSize.width}
            height={stageSize.height}
          />
        </Layer>

        {/* Dim layer — the selection is punched out with "destination-out" */}
        <Layer ref={dimLayerRef} listening={false}>
          <KonvaRect
            x={0}
            y={0}
            width={stageSize.width}
            height={stageSize.height}
            fill="rgba(0,0,0,0.45)"
          />
          {selection && (
            <KonvaRect {...selection} fill="#000" globalCompositeOperation="destination-out" />
          )}
        </Layer>

        {/* Annotations — clipped to the selection */}
        <Layer ref={annoLayerRef} listening={false}>
          {selection && (
            <Group clip={selection}>
              {shapes.map(renderShape)}
              {draft && renderShape(draft)}
            </Group>
          )}
        </Layer>

        {/* Selection outline, handles and size label */}
        <Layer ref={uiLayerRef} listening={false}>
          {selection && <SelectionChrome rect={selection} stage={stageSize} />}
        </Layer>
      </Stage>

      {/*
        Only the live Ctrl state, never standing instructions. The "drag to
        select an area" line used to sit here and followed the cursor across the
        very area being selected; it lives in Settings > Overlay shortcuts now.
      */}
      {phase === 'idle' && ctrlHeld && !dragRef.current && (
        <div className="snap-hint snap-hint--copy" style={{ left: cursor.x, top: cursor.y }}>
          {t('overlay.ctrlHeld')}
        </div>
      )}

      {/* Cursor position */}
      <CursorReadout
        cursor={cursor}
        composite={composite}
        dpr={DPR}
        stage={stageSize}
        visible={phase === 'idle' || dragging}
      />

      {/* Text input — Konva text is edited through an HTML textarea */}
      {textDraft && (
        <textarea
          ref={textInputRef}
          className="snap-textinput"
          style={{
            left: textDraft.x,
            top: textDraft.y,
            color,
            fontSize: textFontSize(sizes.text),
          }}
          value={textDraft.value}
          onChange={(e) => store.updateText(e.target.value)}
          onBlur={() => store.commitText()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              store.commitText()
            }
          }}
        />
      )}

      {selection && !dragging && (
        <>
          <ToolPanel style={toolPanelPosition(selection, stageSize)} />
          <ActionBar
            style={actionBarPosition(selection, stageSize)}
            busy={busy}
            onCopy={() => void commit('copy')}
            onSave={() => void commit('save')}
            onSaveAs={() => void commit('save-as')}
            onCancel={cancel}
          />
        </>
      )}
    </div>
  )
}

// ── Selection chrome ───────────────────────────────────────────────────────

function SelectionChrome({ rect, stage }: { rect: Rect; stage: { width: number; height: number } }) {
  // Report the size in real pixels — that is what ends up in the file.
  const label = `${Math.round(rect.width * DPR)} x ${Math.round(rect.height * DPR)}`
  // The label normally sits above the selection; when there is no room it
  // moves inside.
  const labelY = rect.y > 24 ? rect.y - 22 : rect.y + 4
  const labelX = Math.min(rect.x, stage.width - 90)

  return (
    <>
      {/*
       * Konva can gradient-FILL a shape but not gradient-STROKE one, so the
       * outline is painted by hand: the same ramp the CSS accent uses, running
       * corner to corner across the selection.
       */}
      <KonvaShape
        listening={false}
        sceneFunc={(ctx) => {
          const ramp = ctx.createLinearGradient(
            rect.x,
            rect.y,
            rect.x + rect.width,
            rect.y + rect.height,
          )
          ramp.addColorStop(0, violetAccent.from)
          ramp.addColorStop(1, violetAccent.to)

          ctx.beginPath()
          ctx.rect(rect.x, rect.y, rect.width, rect.height)
          ctx.setAttr('strokeStyle', ramp)
          ctx.setAttr('lineWidth', 1.5)
          ctx.stroke()
        }}
      />

      <KonvaRect
        x={labelX}
        y={labelY}
        width={label.length * 7.5 + 14}
        height={18}
        fill={palette.bg}
        opacity={0.85}
        cornerRadius={4}
        listening={false}
      />
      <Text
        x={labelX + 7}
        y={labelY + 4}
        text={label}
        fill={palette.text}
        fontSize={11}
        fontFamily="Segoe UI, sans-serif"
        listening={false}
      />

      {HANDLES.map((id) => {
        const a = HANDLE_ANCHOR[id]
        return (
          <KonvaRect
            key={id}
            x={rect.x + rect.width * a.x - HANDLE_SIZE / 2}
            y={rect.y + rect.height * a.y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            fill={handleColor(rect, a)}
            stroke={palette.textOnAccent}
            strokeWidth={1}
            listening={false}
          />
        )
      })}
    </>
  )
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * The colour the outline's gradient has where a handle sits.
 *
 * A handle is 8px, far too small to hold a ramp of its own, so it samples one:
 * the anchor is projected onto the gradient's diagonal. Averaging x and y
 * instead would put every corner at the middle of the ramp on a wide selection.
 */
function handleColor(rect: Rect, anchor: Point): string {
  const w2 = rect.width * rect.width
  const h2 = rect.height * rect.height
  const t = w2 + h2 === 0 ? 0.5 : (anchor.x * w2 + anchor.y * h2) / (w2 + h2)
  return mixHex(violetAccent.from, violetAccent.to, t)
}

/** Resizes the rectangle by dragging one of its handles. */
function resizeRect(origin: Rect, handle: HandleId, p: Point): Rect {
  let left = origin.x
  let top = origin.y
  let right = origin.x + origin.width
  let bottom = origin.y + origin.height

  if (handle.includes('w')) left = p.x
  if (handle.includes('e')) right = p.x
  if (handle.includes('n')) top = p.y
  if (handle.includes('s')) bottom = p.y

  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  }
}

function clampPoint(p: Point, rect: Rect): Point {
  return {
    x: Math.min(Math.max(p.x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(p.y, rect.y), rect.y + rect.height),
  }
}

let draftCounter = 0

/** Creates an empty shape at the start of a stroke. */
function createShape(tool: string, p: Point, color: string, thickness: number): Shape {
  const id = `d${++draftCounter}`
  switch (tool) {
    case 'pen':
    case 'marker':
      return { id, type: tool, points: [p.x, p.y], color, thickness }
    case 'line':
    case 'arrow':
      return { id, type: tool, from: p, to: p, color, thickness }
    case 'rect':
    case 'ellipse':
      return { id, type: tool, rect: { x: p.x, y: p.y, width: 0, height: 0 }, color, thickness }
    default:
      return { id, type: 'pen', points: [p.x, p.y], color, thickness }
  }
}

/** Updates the shape as the pointer moves. */
function extendShape(shape: Shape, start: Point, p: Point, mods: Modifiers): Shape {
  switch (shape.type) {
    case 'pen':
    case 'marker': {
      const points = appendPoint(shape.points, p)
      // Unchanged array means the sample was too close to be worth keeping;
      // returning the same shape skips the re-render as well.
      return points === shape.points ? shape : { ...shape, points }
    }
    case 'line':
    case 'arrow':
      return { ...shape, to: segmentTo(start, p, mods) }
    case 'rect':
    case 'ellipse':
      return { ...shape, rect: boxFrom(start, p, mods) }
    default:
      return shape
  }
}

/** Last pass over a shape before it is committed. */
function finishShape(shape: Shape): Shape {
  if (shape.type !== 'pen' && shape.type !== 'marker') return shape
  return { ...shape, points: smoothStroke(shape.points) }
}

/** Reads the modifier state off a mouse or keyboard event. */
function modifiersOf(e: { shiftKey: boolean; altKey: boolean }): Modifiers {
  return { shift: e.shiftKey, alt: e.altKey }
}

const GAP = 8
const PANEL_W = 46
const PANEL_H = 410
const BAR_W = 420
const BAR_H = 40

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Vertical tool bar: to the right of the selection, else to its left, else
 * tucked against the INSIDE of its right edge.
 *
 * That last fallback matters: when the selection covers almost the whole screen
 * both this bar and the action bar used to land in the same corner and overlap.
 * They now retreat to different corners.
 */
function toolPanelPosition(sel: Rect, stage: { width: number; height: number }): React.CSSProperties {
  const outsideRight = sel.x + sel.width + GAP
  const outsideLeft = sel.x - PANEL_W - GAP

  let left: number
  if (outsideRight + PANEL_W <= stage.width) left = outsideRight
  else if (outsideLeft >= GAP) left = outsideLeft
  else left = clamp(sel.x + sel.width - PANEL_W - GAP, GAP, stage.width - PANEL_W - GAP)

  return { left, top: clamp(sel.y, GAP, stage.height - PANEL_H - GAP) }
}

/**
 * Horizontal action bar: below the selection, else above it, else tucked
 * against the INSIDE of its bottom edge.
 */
function actionBarPosition(sel: Rect, stage: { width: number; height: number }): React.CSSProperties {
  const below = sel.y + sel.height + GAP
  const above = sel.y - BAR_H - GAP

  let top: number
  if (below + BAR_H <= stage.height) top = below
  else if (above >= GAP) top = above
  else top = clamp(sel.y + sel.height - BAR_H - GAP, GAP, stage.height - BAR_H - GAP)

  return { left: clamp(sel.x, GAP, stage.width - BAR_W - GAP), top }
}
