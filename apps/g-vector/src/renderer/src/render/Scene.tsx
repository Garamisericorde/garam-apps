/**
 * The document, as SVG.
 *
 * The scene is the only thing inside the viewBox, so everything here is in
 * DOCUMENT coordinates and nothing needs to know the zoom. The editor's own
 * chrome lives in a separate screen-space overlay for the same reason.
 */
import { memo, type ReactElement, type ReactNode } from 'react'
import { isIdentity, matrixToSvg } from '../doc/geom'
import { pathToData } from '../doc/path'
import type { Doc, Layer, SceneNode } from '../doc/types'
import { paintAttrs } from './paint'

export interface SceneProps {
  doc: Doc
  /**
   * Drawn straight after the artboard and under every shape. The grid is the
   * only thing that goes here: it is chrome, but chrome the artwork has to
   * cover, so it cannot live in the screen-space overlay with the rest.
   */
  children?: ReactNode
}

export function Scene({ doc, children }: SceneProps): ReactElement {
  return (
    <>
      <rect
        className="gv-artboard"
        x={0}
        y={0}
        width={doc.artboard.width}
        height={doc.artboard.height}
        fill={doc.artboard.background}
      />
      {children}
      {doc.layers.map((layer) => (
        <LayerGroup key={layer.id} layer={layer} nodes={doc.nodes} />
      ))}
    </>
  )
}

/**
 * One layer, as a group.
 *
 * Its opacity has to be a GROUP opacity rather than a multiplier on each node:
 * two overlapping shapes at 50% each show through one another, while the pair
 * of them in a 50% group does not. That difference is the whole reason a
 * reference image at 30% reads as one faded picture instead of a pile of
 * translucent parts.
 */
function LayerGroup({ layer, nodes }: { layer: Layer; nodes: readonly SceneNode[] }): ReactElement {
  return (
    <g opacity={layer.visible ? layer.opacity : 0} data-layer={layer.id}>
      {nodes.map((node) =>
        node.layer === layer.id && node.visible && layer.visible ? (
          <Shape key={node.id} node={node} />
        ) : null,
      )}
    </g>
  )
}

/**
 * One node.
 *
 * Split out and memoised so a drag re-renders the shape being dragged and
 * nothing else. Our document operations return the SAME object for every node
 * they did not touch, so the identity check here is exact rather than a guess,
 * and the cost of a drag stops growing with the size of the document.
 *
 * Each shape carries its own <defs>. A gradient defined anywhere in the tree is
 * referenceable by id, so keeping it next to its shape is what makes the
 * component self-contained enough to memoise at all.
 */
const Shape = memo(function Shape({ node }: { node: SceneNode }): ReactElement {
  const fill = paintAttrs(node.fill, `${node.id}-f`)
  const stroke = paintAttrs(node.stroke.paint, `${node.id}-s`)
  return (
    <>
      {(fill.def || stroke.def) && (
        <defs>
          {fill.def}
          {stroke.def}
        </defs>
      )}
      {renderNode(node, fill, stroke)}
    </>
  )
})

type Attrs = ReturnType<typeof paintAttrs>

function renderNode(node: SceneNode, fill: Attrs, stroke: Attrs): ReactElement {
  const common = {
    // A node with a strokeless paint still carries a width; passing it through
    // makes no difference to the render and keeps the attribute set stable, so
    // React does not tear the element down when a stroke is switched on.
    fill: fill.value,
    fillOpacity: fill.opacity,
    stroke: stroke.value,
    strokeOpacity: stroke.opacity,
    strokeWidth: node.stroke.paint.kind === 'none' ? 0 : node.stroke.width,
    strokeLinecap: node.stroke.cap,
    strokeLinejoin: node.stroke.join,
    strokeDasharray: node.stroke.dash.length > 0 ? node.stroke.dash.join(' ') : undefined,
    opacity: node.opacity,
    transform: isIdentity(node.transform) ? undefined : matrixToSvg(node.transform),
    'data-node': node.id,
  }

  switch (node.type) {
    case 'rect':
      return (
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={node.radius || undefined}
          {...common}
        />
      )
    case 'ellipse':
      return (
        <ellipse
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          rx={node.width / 2}
          ry={node.height / 2}
          {...common}
        />
      )
    case 'path':
      return <path d={pathToData(node.subpaths)} {...common} />
    case 'image':
      return (
        <image
          href={node.src}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          // The box is the truth: a reference has to sit exactly where it was
          // put, and letting the bitmap keep its own aspect ratio would leave
          // it floating inside a frame that no longer describes it.
          preserveAspectRatio="none"
          {...common}
          fill={undefined}
          stroke={undefined}
        />
      )
  }
}
