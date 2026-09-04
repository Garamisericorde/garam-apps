/**
 * English is the SOURCE dictionary.
 *
 * Every other locale is typed as `Messages`, which is derived from this object,
 * so a missing or misspelled key is a compile error rather than a string that
 * silently falls back at runtime. Add a key here first.
 *
 * Placeholders are `{name}` and are filled by `t()`.
 */
export const en = {
  // ── Tray ────────────────────────────────────────────────────────────────
  'tray.tooltip': 'G-Snap — screen capture',
  'tray.selectRegion': 'Select region',
  'tray.fullScreen': 'Full screen to clipboard',
  'tray.openSaveFolder': 'Open save folder',
  'tray.settings': 'Settings...',
  'tray.version': 'Version {version}',
  'tray.quit': 'Quit',

  // ── Dialogs and notices raised by the main process ──────────────────────
  'dialog.saveScreenshot': 'Save screenshot',
  'dialog.chooseSaveFolder': 'Choose save folder',
  'notice.saved': 'Saved',
  'notice.copied': 'Copied to clipboard',
  'notice.show': 'Show',
  'error.buildImage': 'Could not build the image',
  'error.writeFile': 'Could not write the file. Check the folder permissions.',

  // ── Overlay: action bar ─────────────────────────────────────────────────
  'action.copy': 'Copy',
  'action.save': 'Save',
  'action.saveAs': 'Save as',
  'action.cancel': 'Cancel',

  // ── Overlay: tools ──────────────────────────────────────────────────────
  'tool.none': 'Move / resize',
  'tool.pen': 'Pen',
  'tool.marker': 'Highlighter',
  'tool.line': 'Line',
  'tool.arrow': 'Arrow',
  'tool.rect': 'Rectangle',
  'tool.ellipse': 'Ellipse',
  'tool.text': 'Text',
  'tool.color': 'Color',
  'tool.size': 'Size',
  'tool.undo': 'Undo',
  'tool.redo': 'Redo',
  'tool.clear': 'Clear annotations',
  'overlay.ctrlHeld': 'Ctrl held · will copy to clipboard on release',

  // ── Settings: chrome ────────────────────────────────────────────────────
  'settings.title': 'G-Snap Settings',
  'settings.tagline': 'Screen capture and annotation',
  'settings.shortcutConflict': 'Shortcut conflict',

  // ── Settings: shortcuts ─────────────────────────────────────────────────
  'settings.shortcuts': 'Shortcuts',
  'settings.shortcutsDesc': 'Click a shortcut box, then press the new combination.',
  'settings.selectRegion': 'Select region',
  'settings.selectRegionHint': 'Opens the overlay so you can pick an area and annotate it.',
  'settings.fullScreen': 'Full screen',
  'settings.fullScreenHint': 'Copies the active display straight to the clipboard. No overlay, no file.',
  'settings.shortcutTaken': 'Could not register this shortcut — another app may be using it.',

  // ── Settings: saving ────────────────────────────────────────────────────
  'settings.saving': 'Saving',
  'settings.saveFolder': 'Save folder',
  'settings.browse': 'Browse',
  'settings.fileNameTemplate': 'File name template',
  'settings.fileNameHint': 'Fields: {fields}',
  'settings.imageFormat': 'Image format',
  'settings.formatPng': 'PNG (lossless)',
  'settings.formatJpg': 'JPEG (smaller file)',
  'settings.jpegQuality': 'JPEG quality',

  // ── Settings: behaviour ─────────────────────────────────────────────────
  'settings.behaviour': 'Behaviour',
  'settings.copyOnConfirm': 'Copy to clipboard when a selection is confirmed',
  'settings.askWhereToSave': 'Ask where to save',
  'settings.askWhereToSaveHint': 'When off, files go straight to the save folder.',
  'settings.launchAtStartup': 'Start with Windows',
  'settings.launchAtStartupHint':
    'Registered as a scheduled task, because Windows will not auto-start an elevated app from the usual startup list.',
  'settings.language': 'Language',
  'settings.languageHint': 'Applies everywhere: the tray menu, the overlay and this window.',

  // ── Settings: annotation ────────────────────────────────────────────────
  'settings.annotationDefaults': 'Annotation defaults',
  'settings.penColor': 'Pen color',
  'settings.thickness': 'Thickness',

  // ── Settings: overlay shortcut list ─────────────────────────────────────
  'settings.overlayShortcuts': 'Overlay shortcuts',
  'settings.overlayShortcutsDesc':
    'Everything the capture overlay understands. It is listed here rather than drawn on the overlay, which is meant to show the screen and nothing else.',
  'shortcut.drag': 'Select an area',
  'shortcut.ctrlDrag': 'Copy to clipboard and close as soon as you release',
  'shortcut.shiftDrag': 'Rectangle and ellipse stay square; line and arrow snap to 45°',
  'shortcut.altDrag': 'A square or circle grown from the point you started on',
  'shortcut.esc': 'Clear the selection / close the overlay',
  'shortcut.enter': 'Copy to clipboard',
  'shortcut.ctrlC': 'Copy to clipboard',
  'shortcut.ctrlS': 'Save',
  'shortcut.ctrlShiftS': 'Save as',
  'shortcut.ctrlA': 'Select the whole screen',
  'shortcut.ctrlZ': 'Undo',
  'shortcut.tools': 'Pick a tool (cursor, pen, highlighter, line, arrow, rectangle, ellipse, text)',

  // ── Settings: about ─────────────────────────────────────────────────────
  'settings.about': 'About',
  'settings.openLogs': 'Open logs',
  'settings.restoreDefaults': 'Restore defaults',
} as const
