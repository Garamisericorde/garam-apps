/**
 * The tool rail. One column, one job each, no flyouts.
 *
 * Illustrator hides half its tools behind a long-press on another tool, which
 * is the single largest reason people cannot find anything in it. Every tool
 * here is visible, and there is room for the rest of them because there will
 * never be forty.
 */
import type { ReactElement, ReactNode } from 'react'
import { IconButton, Toolbar, ToolbarSeparator } from '@garam/ui'
import { useEditor, type ToolId } from '../store/editor'
import {
  CurvatureIcon,
  DirectIcon,
  EllipseIcon,
  GridIcon,
  HandIcon,
  MagnetIcon,
  PenIcon,
  RectIcon,
  SelectIcon,
} from './icons'

interface ToolSpec {
  id: ToolId
  label: string
  shortcut: string
  icon: ReactNode
}

/**
 * Every tool, visible, in the order a drawing goes: pick, edit points, draw
 * curves, draw shapes, move the view. Nothing here is behind a flyout, so
 * nothing here can be lost behind a long press on something else.
 */
const TOOLS: ToolSpec[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: <SelectIcon /> },
  { id: 'direct', label: 'Direct select', shortcut: 'A', icon: <DirectIcon /> },
  { id: 'pen', label: 'Pen', shortcut: 'P', icon: <PenIcon /> },
  { id: 'curvature', label: 'Curvature', shortcut: 'C', icon: <CurvatureIcon /> },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', icon: <RectIcon /> },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'E', icon: <EllipseIcon /> },
  { id: 'hand', label: 'Hand', shortcut: 'H', icon: <HandIcon /> },
]

export function ToolRail(): ReactElement {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const snapEnabled = useEditor((s) => s.snapEnabled)
  const toggleSnap = useEditor((s) => s.toggleSnap)
  const gridVisible = useEditor((s) => s.gridVisible)
  const toggleGrid = useEditor((s) => s.toggleGrid)

  return (
    <Toolbar vertical className="gv-rail">
      {TOOLS.map((spec) => (
        <IconButton
          key={spec.id}
          icon={spec.icon}
          label={`${spec.label}  ${spec.shortcut}`}
          tooltipSide="right"
          active={tool === spec.id}
          onClick={() => setTool(spec.id)}
        />
      ))}

      <ToolbarSeparator vertical />

      <IconButton
        icon={<MagnetIcon />}
        label={`Smart guides  Ctrl+U`}
        tooltipSide="right"
        active={snapEnabled}
        onClick={toggleSnap}
      />
      <IconButton
        icon={<GridIcon />}
        label="Grid  Ctrl+'"
        tooltipSide="right"
        active={gridVisible}
        onClick={toggleGrid}
      />
    </Toolbar>
  )
}
