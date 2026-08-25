import {
  ArrowUpRight,
  Circle,
  Highlighter,
  Minus,
  MousePointer2,
  Pen,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react'
import { ColorPicker, IconButton, Slider, Toolbar, ToolbarSeparator } from '@garam/ui'
import { useOverlay } from './store'
import type { ToolId } from './types'

const TOOLS: Array<{ id: ToolId; label: string; icon: React.ReactNode; key: string }> = [
  { id: 'none', label: 'Tasi / boyutlandir', icon: <MousePointer2 size={16} />, key: 'V' },
  { id: 'pen', label: 'Kalem', icon: <Pen size={16} />, key: 'P' },
  { id: 'marker', label: 'Fosforlu kalem', icon: <Highlighter size={16} />, key: 'H' },
  { id: 'line', label: 'Cizgi', icon: <Minus size={16} />, key: 'L' },
  { id: 'arrow', label: 'Ok', icon: <ArrowUpRight size={16} />, key: 'A' },
  { id: 'rect', label: 'Dikdortgen', icon: <Square size={16} />, key: 'R' },
  { id: 'ellipse', label: 'Elips', icon: <Circle size={16} />, key: 'E' },
  { id: 'text', label: 'Metin', icon: <Type size={16} />, key: 'T' },
]

export interface ToolPanelProps {
  style: React.CSSProperties
}

/** Secimin yaninda duran dikey anotasyon cubugu. */
export function ToolPanel({ style }: ToolPanelProps) {
  const tool = useOverlay((s) => s.tool)
  const setTool = useOverlay((s) => s.setTool)
  const color = useOverlay((s) => s.color)
  const setColor = useOverlay((s) => s.setColor)
  const thickness = useOverlay((s) => s.thickness)
  const setThickness = useOverlay((s) => s.setThickness)
  const shapes = useOverlay((s) => s.shapes)
  const redoStack = useOverlay((s) => s.redoStack)
  const undo = useOverlay((s) => s.undo)
  const redo = useOverlay((s) => s.redo)
  const clearShapes = useOverlay((s) => s.clearShapes)

  return (
    <div className="snap-toolpanel" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <Toolbar vertical floating>
        {TOOLS.map((t) => (
          <IconButton
            key={t.id}
            icon={t.icon}
            label={`${t.label}  (${t.key})`}
            tooltipSide="left"
            active={tool === t.id}
            onClick={() => setTool(t.id)}
          />
        ))}

        <ToolbarSeparator vertical />

        <ColorPicker value={color} onChange={setColor} label="Renk" />

        <div className="snap-toolpanel__thickness" data-tooltip="Kalinlik" data-tooltip-side="left">
          <Slider
            value={thickness}
            onChange={setThickness}
            min={1}
            max={12}
            label="Kalinlik"
            className="snap-toolpanel__slider"
          />
          <span className="snap-toolpanel__thickness-value">{thickness}</span>
        </div>

        <ToolbarSeparator vertical />

        <IconButton
          icon={<Undo2 size={16} />}
          label="Geri al  (Ctrl+Z)"
          tooltipSide="left"
          disabled={shapes.length === 0}
          onClick={undo}
        />
        <IconButton
          icon={<Redo2 size={16} />}
          label="Yinele  (Ctrl+Y)"
          tooltipSide="left"
          disabled={redoStack.length === 0}
          onClick={redo}
        />
        <IconButton
          icon={<Trash2 size={16} />}
          label="Cizimleri temizle"
          tooltipSide="left"
          variant="danger"
          disabled={shapes.length === 0}
          onClick={clearShapes}
        />
      </Toolbar>
    </div>
  )
}

/** Klavye kisayolu -> arac eslemesi. */
export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'none',
  p: 'pen',
  h: 'marker',
  l: 'line',
  a: 'arrow',
  r: 'rect',
  e: 'ellipse',
  t: 'text',
}
