import { ipcMain } from 'electron'
import { readEditorState, writeEditorState } from '../settings/EditorState'
import type { EditorState } from '../../shared/types'
import { logger } from '../logging/logger'

/**
 * The editor's own state, kept between runs.
 *
 * Separate from settings: settings are what the user chose about the app, this
 * is what they were in the middle of. Mixing the two would mean "reset to
 * defaults" threw away an edit.
 */
export function registerEditorIpc(): void {
  ipcMain.handle('editor:get', async (): Promise<EditorState> => readEditorState())

  ipcMain.handle('editor:set', async (_event, state: unknown): Promise<void> => {
    try {
      await writeEditorState(state)
    } catch (err) {
      // Never fatal. Losing the arrangement on the next launch is a small
      // failure; an editor that throws while you are working is not.
      logger.warn('Could not save the timeline', String(err))
    }
  })
}
