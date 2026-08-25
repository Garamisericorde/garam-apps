import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Image as KonvaImage, Layer, Rect as KonvaRect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { pixelScaleOf, type CommitRequest, type DisplayShot, type OverlayInit, type Rect } from '@shared/types'
import { useOverlay, textFontSize } from './store'
import { useImages } from './useImages'
import { renderShape, isMeaningful } from './Shapes'
import { ToolPanel, TOOL_SHORTCUTS } from './ToolPanel'
import { ActionBar } from './ActionBar'
import { Magnifier } from './Magnifier'
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

type Drag =
  /**
   * `autoCopy`: surukleme baslarken Ctrl basiliydi. Fare birakilir birakilmaz
   * secim panoya kopyalanip overlay kapanir — Lightshot'un hizli kopyalama
   * akisi. Ctrl'un basili olup olmadigi MOUSEDOWN aninda okunur; surukleme
   * ortasinda birakilmasi kararı degistirmez.
   */
  | { kind: 'new'; start: Point; autoCopy: boolean }
  | { kind: 'move'; start: Point; origin: Rect }
  | { kind: 'resize'; handle: HandleId; origin: Rect }
  | { kind: 'draw'; start: Point }
  | null

export function OverlayApp() {
  const [init, setInit] = useState<OverlayInit | null>(null)
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 })
  const [hoverHandle, setHoverHandle] = useState<HandleId | null>(null)
  const [ctrlHeld, setCtrlHeld] = useState(false)

  const dragRef = useRef<Drag>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const dimLayerRef = useRef<Konva.Layer>(null)
  const uiLayerRef = useRef<Konva.Layer>(null)
  const textInputRef = useRef<HTMLTextAreaElement>(null)

  const store = useOverlay()
  const { phase, selection, tool, color, thickness, shapes, draft, textDraft, stage, origin } = store

  const images = useImages(init?.shots ?? [])

  // ── Ana suructen acilis verisi ─────────────────────────────────────────

  useEffect(() => {
    return window.api.overlay.onInit((payload) => {
      setInit(payload)
      useOverlay.getState().init({
        shots: payload.shots,
        stage: { width: payload.union.width, height: payload.union.height },
        origin: { x: payload.union.x, y: payload.union.y },
        color: payload.defaults.color,
        thickness: payload.defaults.thickness,
        showMagnifier: payload.defaults.showMagnifier,
      })
    })
  }, [])

  // Goruntuler cizildikten sonra pencereyi gorunur yap — siyah flash olmasin.
  useEffect(() => {
    if (images && images.length > 0) {
      void window.api.overlay.ready()
    }
  }, [images])

  // ── Yardimcilar ────────────────────────────────────────────────────────

  const stageBounds = useMemo<Rect>(
    () => ({ x: 0, y: 0, width: stage.width, height: stage.height }),
    [stage.width, stage.height],
  )

  /**
   * Isaretci konumunu NATIVE olaydan hesaplar.
   *
   * Konva'nin `getPointerPosition()` degeri son isaretci olayinda guncelleniyor.
   * Overlay kisayolla acildiginda pencere icinde henuz hicbir hareket olmadigi
   * icin ilk mousedown'da bu deger (0,0) kaliyor ve secim ekranin sol ust
   * kosesinden basliyor. Olayin kendi koordinatlari her zaman dogru.
   */
  const pointerFrom = useCallback((evt: MouseEvent): Point => {
    const container = stageRef.current?.container()
    const box = container?.getBoundingClientRect()
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

  // ── Disa aktarma ───────────────────────────────────────────────────────

  const commit = useCallback(
    async (action: CommitRequest['action']) => {
      const stageNode = stageRef.current
      const sel = useOverlay.getState().selection
      if (!stageNode || !sel || busy) return

      // Devam eden metin girisi varsa once kaydet.
      useOverlay.getState().commitText()

      const rect: Rect = {
        x: Math.round(sel.x),
        y: Math.round(sel.y),
        width: Math.round(sel.width),
        height: Math.round(sel.height),
      }
      if (rect.width < 1 || rect.height < 1) return

      setBusy(true)
      try {
        // Karartma ve secim cercevesi goruntuye girmemeli.
        dimLayerRef.current?.hide()
        uiLayerRef.current?.hide()
        stageNode.batchDraw()

        const dataUrl = stageNode.toDataURL({
          ...rect,
          pixelRatio: scaleForRect(rect, init?.shots ?? [], origin),
          mimeType: 'image/png',
        })

        dimLayerRef.current?.show()
        uiLayerRef.current?.show()
        stageNode.batchDraw()

        await window.api.overlay.commit({
          dataUrl,
          rect: { x: rect.x + origin.x, y: rect.y + origin.y, width: rect.width, height: rect.height },
          action,
        })
      } catch (err) {
        console.error('[overlay] disa aktarma basarisiz', err)
        dimLayerRef.current?.show()
        uiLayerRef.current?.show()
      } finally {
        setBusy(false)
      }
    },
    [busy, init, origin],
  )

  // ── Klavye ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Metin yazarken kisayollar araya girmesin.
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

      // Tum ekrani sec
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

  // Metin girisi acilinca odaklan.
  useEffect(() => {
    if (textDraft) textInputRef.current?.focus()
  }, [textDraft])

  // Ctrl'un basili olup olmadigini izle — ipucu metnini buna gore degistiriyoruz
  // ki kullanici surukemeye baslamadan once ne olacagini gorsun.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(true)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(false)
    }
    // Pencere odagi giderse tus birakma olayi gelmeyebilir; durumu sifirla.
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

  // ── Isaretci olaylari ──────────────────────────────────────────────────

  const onMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (busy) return

      // Sag tik her zaman iptal eder (Lightshot davranisi).
      if (e.evt.button === 2) {
        const s = useOverlay.getState()
        if (s.selection) s.resetSelection()
        else cancel()
        return
      }
      if (e.evt.button !== 0) return

      const p = pointerFrom(e.evt)
      const s = useOverlay.getState()

      // Metin yazilirken baska yere tiklama metni kaydeder.
      if (s.textDraft) {
        s.commitText()
        return
      }

      if (!s.selection) {
        dragRef.current = { kind: 'new', start: p, autoCopy: e.evt.ctrlKey }
        return
      }

      const handle = hitHandle(p)
      if (handle) {
        dragRef.current = { kind: 'resize', handle, origin: s.selection }
        return
      }

      const inside = pointInRect(p, s.selection)

      if (inside && s.tool !== 'none') {
        if (s.tool === 'text') {
          s.startText(p.x, p.y)
          return
        }
        dragRef.current = { kind: 'draw', start: p }
        s.setDraft(createShape(s.tool, p, s.color, s.thickness))
        return
      }

      if (inside) {
        dragRef.current = { kind: 'move', start: p, origin: s.selection }
        return
      }

      // Secim disina tiklama: yeni secim baslat.
      s.resetSelection()
      dragRef.current = { kind: 'new', start: p, autoCopy: e.evt.ctrlKey }
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
          // Cizim secimin disina tasmasin.
          const c = clampPoint(p, s.selection)
          s.setDraft(extendShape(s.draft, drag.start, c))
          break
        }
      }
    },
    [hitHandle, pointerFrom, stageBounds],
  )

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    const s = useOverlay.getState()

    if (drag.kind === 'new' && s.selection) {
      // Cok kucuk secim: kaza eseri tiklama sayilir.
      if (s.selection.width < MIN_SELECTION_SIZE || s.selection.height < MIN_SELECTION_SIZE) {
        s.setSelection(null)
      } else if (drag.autoCopy) {
        // Ctrl basili baslatilan secim: fare birakilinca dogrudan panoya.
        void commit('copy')
      }
    }

    if (drag.kind === 'draw') {
      if (s.draft && isMeaningful(s.draft)) s.commitDraft()
      else s.setDraft(null)
    }
  }, [commit])

  // Fare pencere disina cikip birakilirsa surukleme asili kalmasin.
  useEffect(() => {
    const onWindowUp = () => onMouseUp()
    window.addEventListener('mouseup', onWindowUp)
    return () => window.removeEventListener('mouseup', onWindowUp)
  }, [onMouseUp])

  // ── Render ─────────────────────────────────────────────────────────────

  if (!init || !images) {
    return <div className="snap-overlay snap-overlay--loading" />
  }

  const cursorClass = hoverHandle
    ? ''
    : tool !== 'none' && selection
      ? 'is-drawing'
      : 'is-crosshair'

  const cursorStyle = hoverHandle ? HANDLE_CURSOR[hoverHandle] : undefined

  return (
    <div className={`snap-overlay ${cursorClass}`} style={{ cursor: cursorStyle }}>
      <Stage
        ref={stageRef}
        width={stage.width}
        height={stage.height}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        {/* Dondurulmus ekran goruntuleri */}
        <Layer listening={false}>
          {images.map((shot) => (
            <KonvaImage
              key={shot.displayId}
              image={shot.image}
              x={shot.bounds.x - origin.x}
              y={shot.bounds.y - origin.y}
              width={shot.bounds.width}
              height={shot.bounds.height}
            />
          ))}
        </Layer>

        {/* Karartma — secim alani "destination-out" ile delinir */}
        <Layer ref={dimLayerRef} listening={false}>
          <KonvaRect x={0} y={0} width={stage.width} height={stage.height} fill="rgba(0,0,0,0.45)" />
          {selection && (
            <KonvaRect
              {...selection}
              fill="#000"
              globalCompositeOperation="destination-out"
            />
          )}
        </Layer>

        {/* Anotasyonlar — secime kirpilir */}
        <Layer listening={false}>
          {selection && (
            <Group clip={selection}>
              {shapes.map(renderShape)}
              {draft && renderShape(draft)}
              {textDraft && textDraft.value && (
                <Text
                  x={textDraft.x}
                  y={textDraft.y}
                  text={textDraft.value}
                  fill={color}
                  fontSize={textFontSize(thickness)}
                  fontFamily="Segoe UI, sans-serif"
                  fontStyle="600"
                  opacity={0}
                />
              )}
            </Group>
          )}
        </Layer>

        {/* Secim cercevesi, tutamaklar ve olcu etiketi */}
        <Layer ref={uiLayerRef} listening={false}>
          {selection && <SelectionChrome rect={selection} stage={stage} />}
        </Layer>
      </Stage>

      {/* Henuz secim yokken yonlendirme */}
      {phase === 'idle' && !dragRef.current && (
        <div
          className={`snap-hint ${ctrlHeld ? 'snap-hint--copy' : ''}`}
          style={{ left: cursor.x, top: cursor.y }}
        >
          {ctrlHeld ? (
            <>
              <kbd>Ctrl</kbd> basili &middot; birakinca panoya kopyalanacak
            </>
          ) : (
            <>
              Bir alan secmek icin surukleyin &middot; <kbd>Ctrl</kbd> ile surukle = dogrudan
              panoya &middot; <kbd>Esc</kbd> iptal
            </>
          )}
        </div>
      )}

      {/* Piksel buyutec */}
      <Magnifier
        cursor={cursor}
        shots={images}
        origin={origin}
        stage={stage}
        visible={store.showMagnifier && phase === 'idle'}
      />

      {/* Metin girisi — Konva metni HTML textarea ile duzenleniyor */}
      {textDraft && (
        <textarea
          ref={textInputRef}
          className="snap-textinput"
          style={{
            left: textDraft.x,
            top: textDraft.y,
            color,
            fontSize: textFontSize(thickness),
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

      {selection && (
        <>
          <ToolPanel style={toolPanelPosition(selection, stage)} />
          <ActionBar
            style={actionBarPosition(selection, stage)}
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

// ── Secim cercevesi ────────────────────────────────────────────────────────

function SelectionChrome({ rect, stage }: { rect: Rect; stage: { width: number; height: number } }) {
  const label = `${Math.round(rect.width)} x ${Math.round(rect.height)}`
  // Etiket normalde secimin ustunde; yukarida yer yoksa icine alinir.
  const labelY = rect.y > 24 ? rect.y - 22 : rect.y + 4
  const labelX = Math.min(rect.x, stage.width - 90)

  return (
    <>
      <KonvaRect {...rect} stroke="#e94560" strokeWidth={1.5} listening={false} />

      <KonvaRect
        x={labelX}
        y={labelY}
        width={label.length * 7.5 + 14}
        height={18}
        fill="rgba(20,20,42,0.85)"
        cornerRadius={4}
        listening={false}
      />
      <Text
        x={labelX + 7}
        y={labelY + 4}
        text={label}
        fill="#eaeaea"
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
            fill="#e94560"
            stroke="#ffffff"
            strokeWidth={1}
            listening={false}
          />
        )
      })}
    </>
  )
}

// ── Saf yardimcilar ────────────────────────────────────────────────────────

/** Tutamak surukleyerek dikdortgeni yeniden boyutlandirir. */
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

/** Cizime baslarken bos bir sekil olusturur. */
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

/** Suruklerken sekli gunceller. */
function extendShape(shape: Shape, start: Point, p: Point): Shape {
  switch (shape.type) {
    case 'pen':
    case 'marker':
      return { ...shape, points: [...shape.points, p.x, p.y] }
    case 'line':
    case 'arrow':
      return { ...shape, to: p }
    case 'rect':
    case 'ellipse':
      return { ...shape, rect: rectFromPoints(start, p) }
    default:
      return shape
  }
}

/**
 * Secimin bulundugu ekranin olcegini bulur — disa aktarmada gercek piksel
 * cozunurlugunu korumak icin gerekli.
 *
 * Olcek isletim sisteminin scaleFactor'undan DEGIL, yakalanan goruntunun
 * gercek piksel sayisindan turetiliyor. Kesirli DPI'da ikisi ayrisiyor;
 * scaleFactor kullanilirsa kaydedilen goruntu kesirli oranda yeniden
 * orneklenir ve yumusar.
 */
function scaleForRect(
  rect: Rect,
  shots: DisplayShot[],
  origin: { x: number; y: number },
): number {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2

  const shot = shots.find((s) => {
    const left = s.bounds.x - origin.x
    const top = s.bounds.y - origin.y
    return cx >= left && cx < left + s.bounds.width && cy >= top && cy < top + s.bounds.height
  })

  return shot ? pixelScaleOf(shot) : 1
}

const GAP = 8
const PANEL_W = 46
const PANEL_H = 430
const BAR_W = 420
const BAR_H = 40

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Dikey arac cubugu: secimin sagina, sigmazsa soluna, o da sigmazsa secimin
 * IC sag kenarina.
 *
 * Ic kenara gecme onemli: secim neredeyse tum ekrani kapladiginda hem bu cubuk
 * hem eylem cubugu ayni kose bosluguna dusup ust uste biniyordu. Ikisi farkli
 * kosata sigindigi icin artik cakismiyorlar.
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
 * Yatay eylem cubugu: secimin altina, sigmazsa ustune, o da sigmazsa secimin
 * IC alt kenarina.
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
