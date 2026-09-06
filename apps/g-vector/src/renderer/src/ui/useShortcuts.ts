/**
 * Keyboard shortcuts, in one place.
 *
 * The first rule is the one editors get wrong: a key pressed inside a text
 * field belongs to that field. Without the check below, typing a width of "5"
 * would also delete the selection and switch to the ellipse tool.
 */
import { useEffect } from 'react'
import { useEditor, type ToolId } from '../store/editor'
import { stepZoom } from '../view/viewport'
import { isTyping } from './typing'

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  a: 'direct',
  p: 'pen',
  c: 'curvature',
  r: 'rect',
  e: 'ellipse',
  h: 'hand',
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return
      const state = useEditor.getState()
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (mod) {
        switch (key) {
          case 'z':
            event.preventDefault()
            if (event.shiftKey) state.redo()
            else state.undo()
            return
          case 'y':
            event.preventDefault()
            state.redo()
            return
          case 'a':
            event.preventDefault()
            state.selectAll()
            return
          case 'c':
            // Paste is not here: it arrives as a `paste` event, which is the
            // only way to see what the system clipboard actually holds.
            state.copySelection()
            return
          case 'd':
            event.preventDefault()
            state.duplicateSelection()
            return
          case 'u':
            // Illustrator's own shortcut for smart guides — the one piece of
            // its muscle memory worth keeping.
            event.preventDefault()
            state.toggleSnap()
            return
          case "'":
            event.preventDefault()
            state.toggleGrid()
            return
          case '0':
            event.preventDefault()
            state.fitArtboard()
            return
          case '1':
            event.preventDefault()
            state.setZoom(1)
            return
          case '=':
          case '+':
            event.preventDefault()
            state.setZoom(stepZoom(state.viewport.zoom, 1))
            return
          case '-':
            event.preventDefault()
            state.setZoom(stepZoom(state.viewport.zoom, -1))
            return
          case ']':
            event.preventDefault()
            state.reorderSelection(event.shiftKey ? 'front' : 'forward')
            return
          case '[':
            event.preventDefault()
            state.reorderSelection(event.shiftKey ? 'back' : 'backward')
            return
          default:
            return
        }
      }

      if (key === 'delete' || key === 'backspace') {
        event.preventDefault()
        // With points picked out, Delete means those points — deleting the whole
        // path instead is the classic way to lose ten minutes of work.
        if (state.anchorSelection.length > 0) state.deleteAnchorSelection()
        else state.deleteSelection()
        return
      }

      if (key === 'enter') {
        event.preventDefault()
        state.finishDrawing()
        return
      }

      if (key === 'escape') {
        // Escape backs out one level at a time: first the path being drawn,
        // then the anchors, then the selection.
        if (state.penDraft) state.finishDrawing()
        else if (state.anchorSelection.length > 0) state.clearAnchorSelection()
        else state.clearSelection()
        return
      }

      // Arrow keys nudge by one unit, or by ten with Shift — the same pair of
      // distances every editor uses, so the fingers already know them.
      const step = event.shiftKey ? 10 : 1
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          state.nudgeSelection(-step, 0)
          return
        case 'ArrowRight':
          event.preventDefault()
          state.nudgeSelection(step, 0)
          return
        case 'ArrowUp':
          event.preventDefault()
          state.nudgeSelection(0, -step)
          return
        case 'ArrowDown':
          event.preventDefault()
          state.nudgeSelection(0, step)
          return
      }

      const tool = TOOL_KEYS[key]
      if (tool) state.setTool(tool)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
