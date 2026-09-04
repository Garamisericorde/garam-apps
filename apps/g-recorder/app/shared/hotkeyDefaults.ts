import type { AppSettings } from './types'

/**
 * The stock key bindings, in shared code because Settings needs to offer them
 * back. The rest of the defaults live in the main process, which cannot be
 * imported here — it pulls in electron.
 */

/**
 * Following NVIDIA ShadowPlay: the scheme most people recording games already
 * have in their fingers. Alt+F9 records, Alt+F10 saves the replay, and the
 * buffer toggle takes the shifted form of the save key because the two belong
 * to the same feature.
 */
export const DEFAULT_HOTKEYS: Pick<
  AppSettings,
  'hotkeySaveReplay' | 'hotkeyToggleRecording' | 'hotkeyRecordToFile'
> = {
  hotkeySaveReplay: 'Alt+F10',
  hotkeyToggleRecording: 'Alt+Shift+F10',
  hotkeyRecordToFile: 'Alt+F9',
}

/** What video tools have used for decades */
export const DEFAULT_EDITOR_KEYS: Pick<
  AppSettings,
  | 'editorKeyPlayPause'
  | 'editorKeyCutStart'
  | 'editorKeyCutEnd'
  | 'editorKeySplit'
  | 'editorKeyFullscreen'
> = {
  editorKeyPlayPause: 'Space',
  editorKeyCutStart: 'I',
  editorKeyCutEnd: 'O',
  editorKeySplit: 'S',
  editorKeyFullscreen: 'F',
}

/**
 * Controller shortcuts start unbound.
 *
 * Every button on a pad already means something in every game, so a default
 * binding would be a replay saved on somebody's dodge roll. The user picks the
 * combination they know their games leave alone.
 */
export const DEFAULT_PAD_BINDINGS: Pick<
  AppSettings,
  'padSaveReplay' | 'padToggleRecording' | 'padRecordToFile'
> = {
  padSaveReplay: null,
  padToggleRecording: null,
  padRecordToFile: null,
}
