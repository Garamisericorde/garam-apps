import { Arrow, Ellipse, Line, Rect as KonvaRect, Text } from 'react-konva'
import type { Shape } from './types'
import { MARKER_OPACITY, MARKER_THICKNESS_SCALE } from './types'

/** Tek bir anotasyon seklini Konva dugumune cevirir. */
export function renderShape(shape: Shape) {
  switch (shape.type) {
    case 'pen':
      return (
        <Line
          key={shape.id}
          points={shape.points}
          stroke={shape.color}
          strokeWidth={shape.thickness}
          lineCap="round"
          lineJoin="round"
          tension={0.3}
          listening={false}
        />
      )

    case 'marker':
      return (
        <Line
          key={shape.id}
          points={shape.points}
          stroke={shape.color}
          strokeWidth={shape.thickness * MARKER_THICKNESS_SCALE}
          opacity={MARKER_OPACITY}
          lineCap="round"
          lineJoin="round"
          listening={false}
          // Fosforlu kalem ust uste gecen vuruslarda koyulasmasin.
          globalCompositeOperation="source-over"
        />
      )

    case 'line':
      return (
        <Line
          key={shape.id}
          points={[shape.from.x, shape.from.y, shape.to.x, shape.to.y]}
          stroke={shape.color}
          strokeWidth={shape.thickness}
          lineCap="round"
          listening={false}
        />
      )

    case 'arrow':
      return (
        <Arrow
          key={shape.id}
          points={[shape.from.x, shape.from.y, shape.to.x, shape.to.y]}
          stroke={shape.color}
          fill={shape.color}
          strokeWidth={shape.thickness}
          pointerLength={Math.max(8, shape.thickness * 3)}
          pointerWidth={Math.max(8, shape.thickness * 3)}
          lineCap="round"
          listening={false}
        />
      )

    case 'rect':
      return (
        <KonvaRect
          key={shape.id}
          x={shape.rect.x}
          y={shape.rect.y}
          width={shape.rect.width}
          height={shape.rect.height}
          stroke={shape.color}
          strokeWidth={shape.thickness}
          listening={false}
        />
      )

    case 'ellipse':
      return (
        <Ellipse
          key={shape.id}
          x={shape.rect.x + shape.rect.width / 2}
          y={shape.rect.y + shape.rect.height / 2}
          radiusX={shape.rect.width / 2}
          radiusY={shape.rect.height / 2}
          stroke={shape.color}
          strokeWidth={shape.thickness}
          listening={false}
        />
      )

    case 'text':
      return (
        <Text
          key={shape.id}
          x={shape.x}
          y={shape.y}
          text={shape.text}
          fill={shape.color}
          fontSize={shape.fontSize}
          fontFamily="Segoe UI, sans-serif"
          fontStyle="600"
          listening={false}
        />
      )

    default:
      return null
  }
}

/** Cizilmeye deger mi? Sifir boyutlu sekilleri kaydetmeyelim. */
export function isMeaningful(shape: Shape): boolean {
  switch (shape.type) {
    case 'pen':
    case 'marker':
      return shape.points.length >= 4
    case 'line':
    case 'arrow':
      return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) >= 3
    case 'rect':
    case 'ellipse':
      return shape.rect.width >= 3 && shape.rect.height >= 3
    case 'text':
      return shape.text.trim().length > 0
    default:
      return false
  }
}
