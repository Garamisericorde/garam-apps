/**
 * The window: title bar, tool rail, canvas, inspector, status strip.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { IconButton, TitleBar } from '@garam/ui'
import { useEditor } from '../store/editor'
import { Canvas } from './Canvas'
import { Inspector } from './Inspector'
import { Layers } from './Layers'
import { useImageInput } from './images'
import { StatusBar } from './StatusBar'
import { ToolRail } from './ToolRail'
import { useShortcuts } from './useShortcuts'
import { AppIcon, RedoIcon, UndoIcon } from './icons'

export function App(): ReactElement {
  useShortcuts()
  useImageInput()

  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => window.api.window.onMaximizedChange(setMaximized), [])

  return (
    <div className="gv-app">
      <TitleBar
        title="G-Vector"
        icon={<AppIcon />}
        onMinimize={() => void window.api.window.minimize()}
        onMaximize={() => void window.api.window.maximize()}
        onClose={() => void window.api.window.close()}
      >
        <IconButton
          icon={<UndoIcon />}
          label="Undo  Ctrl+Z"
          disabled={!canUndo}
          onClick={undo}
        />
        <IconButton
          icon={<RedoIcon />}
          label="Redo  Ctrl+Shift+Z"
          disabled={!canRedo}
          onClick={redo}
        />
      </TitleBar>

      {/*
        A maximized frameless window has no drop shadow, so its rounded corners
        have to be squared off — otherwise the desktop shows through four gaps.
      */}
      <div className="gv-body" data-maximized={maximized || undefined}>
        <ToolRail />
        <Canvas />
        {/*
          Properties above, layers below, in one column. They are the two halves
          of "what is this thing" and looking at one almost always means looking
          at the other, so they share a side rather than sitting at opposite
          edges of the window with the drawing in between.
        */}
        <div className="gv-side">
          <Inspector />
          <Layers />
        </div>
      </div>

      <StatusBar />
    </div>
  )
}
