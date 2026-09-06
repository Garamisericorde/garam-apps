/**
 * The editor's own chrome: selection frame, handles, marquee, smart guides and
 * the path-editing skeleton.
 *
 * Drawn in SCREEN pixels, in a second SVG stacked over the scene. That is what
 * makes a handle 8 px and a guide 1 px at every zoom level, with no `/ zoom`
 * scattered through the drawing code and no reliance on non-scaling-stroke.
 */
import type { ReactElement } from 'react'
import type { SelectionFrame } from '../doc/bounds'
import type { Rect, Vec } from '../doc/geom'
import type { Guide, SpacingGuide } from '../snap/types'
import { HANDLE_SIZE, handlePoints } from '../tools/handles'
import type { AnchorView, PathView, SubPathView } from '../tools/paths'
import type { DrawGhost } from '../tools/penTool'
import { docToScreen, type Viewport } from '../view/viewport'

export interface OverlayProps {
  size: { width: number; height: number }
  viewport: Viewport
  frame: SelectionFrame | null
  /** Bounding quad of the node under the cursor, in document space. */
  hover: Vec[] | null
  guides: Guide[]
  spacing: SpacingGuide[]
  /** Rubber band, in screen space. */
  marquee: Rect | null
  /**
   * Live measurement, anchored in screen space. `matched` marks a value that
   * latched onto something — an equal length, say — rather than one that merely
   * happens to read as it does.
   */
  readout: { text: string; at: Vec; matched?: boolean } | null
  showHandles: boolean
  /** Anchor skeletons for the paths being edited. */
  paths: PathView[]
  ghost: DrawGhost | null
  /**
   * An anchor the next click would act on — close the path, or remove the
   * point. Ringed, so the click is not a guess.
   */
  markedAnchor: Vec | null
}

export function Overlay(props: OverlayProps): ReactElement {
  const { viewport: vp, size } = props
  const toScreen = (p: Vec): Vec => docToScreen(vp, p)

  return (
    <svg className="gv-overlay" width={size.width} height={size.height} aria-hidden="true">
      {props.hover && (
        <polygon
          className="gv-hover"
          points={props.hover.map(toScreen).map((p) => `${p.x},${p.y}`).join(' ')}
        />
      )}

      {props.frame && (
        <polygon
          className="gv-frame"
          points={props.frame.corners.map(toScreen).map((p) => `${p.x},${p.y}`).join(' ')}
        />
      )}

      {props.frame &&
        props.showHandles &&
        handlePoints(props.frame, vp).map((handle) => (
          <rect
            key={handle.id}
            className="gv-handle"
            x={handle.p.x - HANDLE_SIZE / 2}
            y={handle.p.y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
          />
        ))}

      {props.paths.map((path) =>
        path.subpaths.map((sp, i) => (
          <SubPathChrome
            key={`${path.nodeId}:${i}`}
            sp={sp}
            vp={vp}
            hideOutline={
              props.ghost?.replaces?.nodeId === path.nodeId &&
              props.ghost.replaces.subpath === i
            }
          />
        )),
      )}

      {props.ghost && <Ghost ghost={props.ghost} vp={vp} />}

      {props.markedAnchor && (
        <circle
          className="gv-anchor-mark"
          cx={toScreen(props.markedAnchor).x}
          cy={toScreen(props.markedAnchor).y}
          r={7}
        />
      )}

      {props.marquee && (
        <rect
          className="gv-marquee"
          x={props.marquee.x}
          y={props.marquee.y}
          width={props.marquee.width}
          height={props.marquee.height}
        />
      )}

      {props.guides.map((guide, i) => (
        <GuideLine key={`g${i}`} guide={guide} vp={vp} />
      ))}

      {props.spacing.map((hint, i) => (
        <SpacingHint key={`s${i}`} hint={hint} vp={vp} />
      ))}

      {props.readout && (
        <Chip
          text={props.readout.text}
          at={props.readout.at}
          variant={props.readout.matched ? 'match' : 'readout'}
        />
      )}
    </svg>
  )
}

/* ── Path skeleton ───────────────────────────────────────────────────────── */

/**
 * The outline, the handles and the points of one subpath.
 *
 * The outline is rebuilt from the anchors in SCREEN space rather than reusing
 * the scene's path data. An affine transform of a cubic is the cubic of the
 * transformed control points, so the two curves are identical — and this one
 * needs no viewBox, no transform attribute and no non-scaling-stroke to stay a
 * hairline at any zoom.
 */
function SubPathChrome({
  sp,
  vp,
  hideOutline,
}: {
  sp: SubPathView
  vp: Viewport
  /** Set when a ghost is showing this subpath's next shape instead. */
  hideOutline?: boolean
}): ReactElement {
  const at = (p: Vec): Vec => docToScreen(vp, p)

  return (
    <g className="gv-path">
      {!hideOutline && <path className="gv-path__outline" d={outlineData(sp, vp)} />}

      {sp.anchors.map((anchor) =>
        anchor.showHandles ? (
          <g className="gv-path__handles" key={`h${anchor.ref.index}`}>
            {([anchor.inTip, anchor.outTip] as const).map((tip, i) => {
              if (!tip) return null
              const a = at(anchor.p)
              const b = at(tip)
              return (
                <g key={i}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                  <circle cx={b.x} cy={b.y} r={3} />
                </g>
              )
            })}
          </g>
        ) : null,
      )}

      {sp.anchors.map((anchor) => (
        <AnchorMark key={`a${anchor.ref.index}`} anchor={anchor} at={at(anchor.p)} />
      ))}
    </g>
  )
}

/**
 * A corner is a square and a smooth point is a circle.
 *
 * The shape carries information the colour cannot: whether the next drag will
 * bend the curve or break it. Illustrator draws both as squares and leaves you
 * to find out by trying.
 */
function AnchorMark({ anchor, at }: { anchor: AnchorView; at: Vec }): ReactElement {
  const className = `gv-anchor${anchor.selected ? ' is-selected' : ''}`
  if (anchor.corner) {
    const s = 6
    return <rect className={className} x={at.x - s / 2} y={at.y - s / 2} width={s} height={s} />
  }
  return <circle className={className} cx={at.x} cy={at.y} r={3.5} />
}

function outlineData(sp: SubPathView, vp: Viewport): string {
  const anchors = sp.anchors
  if (anchors.length === 0) return ''
  const at = (p: Vec): Vec => docToScreen(vp, p)
  const n = (v: number): string => String(Math.round(v * 10) / 10)

  const first = at(anchors[0].p)
  let d = `M ${n(first.x)} ${n(first.y)}`
  const last = sp.closed ? anchors.length : anchors.length - 1

  for (let i = 0; i < last; i++) {
    const from = anchors[i]
    const to = anchors[(i + 1) % anchors.length]
    const c1 = at(from.outTip ?? from.p)
    const c2 = at(to.inTip ?? to.p)
    const end = at(to.p)
    d += ` C ${n(c1.x)} ${n(c1.y)}, ${n(c2.x)} ${n(c2.y)}, ${n(end.x)} ${n(end.y)}`
  }
  if (sp.closed) d += ' Z'
  return d
}

function Ghost({ ghost, vp }: { ghost: DrawGhost; vp: Viewport }): ReactElement | null {
  if (ghost.segments.length === 0) return null
  const p = (v: Vec): string => {
    const s = docToScreen(vp, v)
    return `${Math.round(s.x * 10) / 10} ${Math.round(s.y * 10) / 10}`
  }
  let d = `M ${p(ghost.segments[0].p0)}`
  for (const seg of ghost.segments) d += ` C ${p(seg.c1)}, ${p(seg.c2)}, ${p(seg.p1)}`
  return <path className="gv-pen-ghost" d={d} />
}

/* ── Smart guides ────────────────────────────────────────────────────────── */

/** How far past its span a guide line runs, so it does not end flush on an edge. */
const GUIDE_OVERSHOOT = 12
/** Length of the tick that caps each end of a guide. */
const TICK = 4

function GuideLine({ guide, vp }: { guide: Guide; vp: Viewport }): ReactElement {
  // The guide is one document coordinate on its own axis and a span on the
  // other, so it converts one number at a time rather than a point.
  const onAxis = (v: number): number =>
    guide.axis === 'x' ? (v - vp.x) * vp.zoom : (v - vp.y) * vp.zoom
  const acrossAxis = (v: number): number =>
    guide.axis === 'x' ? (v - vp.y) * vp.zoom : (v - vp.x) * vp.zoom

  const at = onAxis(guide.value)
  const start = acrossAxis(guide.from) - GUIDE_OVERSHOOT
  const end = acrossAxis(guide.to) + GUIDE_OVERSHOOT

  const line =
    guide.axis === 'x'
      ? { x1: at, y1: start, x2: at, y2: end }
      : { x1: start, y1: at, x2: end, y2: at }

  const caps =
    guide.axis === 'x'
      ? [
          { x1: at - TICK, y1: start, x2: at + TICK, y2: start },
          { x1: at - TICK, y1: end, x2: at + TICK, y2: end },
        ]
      : [
          { x1: start, y1: at - TICK, x2: start, y2: at + TICK },
          { x1: end, y1: at - TICK, x2: end, y2: at + TICK },
        ]

  return (
    <g className={`gv-guide gv-guide--${guide.kind}`}>
      <line {...line} />
      {caps.map((cap, i) => (
        <line key={i} {...cap} />
      ))}
    </g>
  )
}

function SpacingHint({ hint, vp }: { hint: SpacingGuide; vp: Viewport }): ReactElement {
  const label = `${Math.round(hint.distance)}`
  return (
    <g className="gv-spacing">
      {hint.bars.map((bar, i) => {
        const a = docToScreen(
          vp,
          hint.axis === 'x' ? { x: bar.start, y: bar.at } : { x: bar.at, y: bar.start },
        )
        const b = docToScreen(
          vp,
          hint.axis === 'x' ? { x: bar.end, y: bar.at } : { x: bar.at, y: bar.end },
        )
        const capA =
          hint.axis === 'x'
            ? { x1: a.x, y1: a.y - 5, x2: a.x, y2: a.y + 5 }
            : { x1: a.x - 5, y1: a.y, x2: a.x + 5, y2: a.y }
        const capB =
          hint.axis === 'x'
            ? { x1: b.x, y1: b.y - 5, x2: b.x, y2: b.y + 5 }
            : { x1: b.x - 5, y1: b.y, x2: b.x + 5, y2: b.y }
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <line {...capA} />
            <line {...capB} />
            <Chip
              text={label}
              at={{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }}
              variant="spacing"
            />
          </g>
        )
      })}
    </g>
  )
}

/** A small label. Sized from the text length — no measuring pass, no reflow. */
function Chip({
  text,
  at,
  variant,
}: {
  text: string
  at: Vec
  variant: 'spacing' | 'readout' | 'match' | 'match'
}): ReactElement {
  const width = 10 + text.length * 6.4
  const height = 17
  return (
    <g className={`gv-chip gv-chip--${variant}`} transform={`translate(${at.x} ${at.y})`}>
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={3} />
      <text x={0} y={0} dominantBaseline="central" textAnchor="middle">
        {text}
      </text>
    </g>
  )
}
