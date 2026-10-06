/**
 * The window: title bar, tool rail, canvas, inspector, status strip.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { NO_INSET, type WindowInset } from '@shared/types'
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
  const [inset, setInset] = useState<WindowInset>(NO_INSET)

  useEffect(() => window.api.window.onStateChange((state) => setInset(state.inset)), [])

  /*
   * The app is padded by however much of the window is off screen.
   *
     *
   * Windows maximises a frameless window to the work area plus its invisible
   * resize border, so without this the top of the title bar — and with it the
   * whole strip you drag the window by — sits above the top of the display, and
   * the controls nearest the right edge are half past it.
   */
  return (
    <div
      className="gv-app"
      style={{
        paddingTop: inset.top,
        paddingRight: inset.right,
        paddingBottom: inset.bottom,
        paddingLeft: inset.left,
      }}
    >
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

      <div className="gv-body">
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
