import { useLayoutEffect, useRef, useState } from 'react'
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
import type { SizedTool, ToolId } from './types'
import { MARKER_OPACITY, SIZE_RANGE } from './types'
import { t, type MessageKey } from '@shared/i18n/index.js'

const TOOLS: Array<{ id: ToolId; label: MessageKey; icon: React.ReactNode; key: string }> = [
  { id: 'none', label: 'tool.none', icon: <MousePointer2 size={16} />, key: 'V' },
  { id: 'pen', label: 'tool.pen', icon: <Pen size={16} />, key: 'P' },
  { id: 'marker', label: 'tool.marker', icon: <Highlighter size={16} />, key: 'H' },
  { id: 'line', label: 'tool.line', icon: <Minus size={16} />, key: 'L' },
  { id: 'arrow', label: 'tool.arrow', icon: <ArrowUpRight size={16} />, key: 'A' },
  { id: 'rect', label: 'tool.rect', icon: <Square size={16} />, key: 'R' },
  { id: 'ellipse', label: 'tool.ellipse', icon: <Circle size={16} />, key: 'E' },
  { id: 'text', label: 'tool.text', icon: <Type size={16} />, key: 'T' },
]

/** How much room the size flyout needs beside the panel. */
const FLYOUT_W = 190

export interface ToolPanelProps {
  style: React.CSSProperties
}

/** Vertical annotation bar shown beside the selection. */
export function ToolPanel({ style }: ToolPanelProps) {
  const tool = useOverlay((s) => s.tool)
  const setTool = useOverlay((s) => s.setTool)
  const color = useOverlay((s) => s.color)
  const setColor = useOverlay((s) => s.setColor)
  const shapes = useOverlay((s) => s.shapes)
  const redoStack = useOverlay((s) => s.redoStack)
  const undo = useOverlay((s) => s.undo)
  const redo = useOverlay((s) => s.redo)
  const clearShapes = useOverlay((s) => s.clearShapes)

  const panelRef = useRef<HTMLDivElement>(null)
  const [flyoutSide, setFlyoutSide] = useState<'right' | 'left'>('right')

  // The panel itself flips between the two sides of the selection, so the
  // flyout has to work out which way it has room to open.
  useLayoutEffect(() => {
    const box = panelRef.current?.getBoundingClientRect()
    if (!box) return
    setFlyoutSide(box.right + FLYOUT_W > window.innerWidth ? 'left' : 'right')
  }, [style])

  return (
    <div
      ref={panelRef}
      className="snap-toolpanel"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Toolbar vertical floating>
        {TOOLS.map((item) => (
          <div className="snap-tool" key={item.id}>
            <IconButton
              icon={item.icon}
              label={`${t(item.label)}  (${item.key})`}
              tooltipSide="left"
              active={tool === item.id}
              onClick={() => setTool(item.id)}
            />
            {/*
              The size control belongs to the tool it sizes, so it opens beside
              that tool's own button. One shared slider meant setting a pen
              width also set the highlighter's, which is never what you want.
            */}
            {tool === item.id && item.id !== 'none' && (
              <SizeFlyout tool={item.id as SizedTool} side={flyoutSide} />
            )}
          </div>
        ))}

        <ToolbarSeparator vertical />

        <ColorPicker value={color} onChange={setColor} label={t('tool.color')} />

        <ToolbarSeparator vertical />

        <IconButton
          icon={<Undo2 size={16} />}
          label={`${t('tool.undo')}  (Ctrl+Z)`}
          tooltipSide="left"
          disabled={shapes.length === 0}
          onClick={undo}
        />
        <IconButton
          icon={<Redo2 size={16} />}
          label={`${t('tool.redo')}  (Ctrl+Y)`}
          tooltipSide="left"
          disabled={redoStack.length === 0}
          onClick={redo}
        />
        <IconButton
          icon={<Trash2 size={16} />}
          label={t('tool.clear')}
          tooltipSide="left"
          variant="danger"
          disabled={shapes.length === 0}
          onClick={clearShapes}
        />
      </Toolbar>
    </div>
  )
}

/** Size slider for one tool, anchored to that tool's button. */
function SizeFlyout({ tool, side }: { tool: SizedTool; side: 'right' | 'left' }) {
  const size = useOverlay((s) => s.sizes[tool])
  const setSize = useOverlay((s) => s.setSize)
  const color = useOverlay((s) => s.color)
  const range = SIZE_RANGE[tool]

  return (
    <div className={`snap-toolsize snap-toolsize--${side}`}>
      {/*
        A dot at the actual stroke width. A number alone does not tell you what
        a 24px highlighter looks like, and this is a drawing tool.
      */}
      <span className="snap-toolsize__dot">
        <span
          className="snap-toolsize__preview"
          style={{
            width: Math.min(size, 26),
            height: Math.min(size, 26),
            background: color,
            opacity: tool === 'marker' ? MARKER_OPACITY + 0.3 : 1,
          }}
        />
      </span>
      <Slider
        value={size}
        onChange={(v) => setSize(tool, v)}
        min={range.min}
        max={range.max}
        label={t('tool.size')}
        className="snap-toolsize__slider"
      />
      <span className="snap-toolsize__value">{size}</span>
    </div>
  )
}

/** Keyboard shortcut -> tool mapping. */
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
