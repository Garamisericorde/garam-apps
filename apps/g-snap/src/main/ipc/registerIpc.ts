import { t } from '@shared/i18n/index.js'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import type { Logger, SettingsStore } from '@garam/core'
import { CHANNELS, EVENTS, type CommitRequest, type CommitResult, type SnapSettings } from '@shared/types'
import type { OverlayController } from '../overlay/OverlayWindow.js'
import type { SaveService } from '../output/SaveService.js'
import type { HotkeyManager } from '../hotkeys/HotkeyManager.js'

export interface IpcDeps {
  settings: SettingsStore<SnapSettings>
  overlay: OverlayController
  saver: SaveService
  hotkeys: HotkeyManager
  log: Logger
  /** Used to re-register the shortcuts when the settings change. */
  onSettingsChanged: (changed: Array<keyof SnapSettings>) => void
}

/**
 * Every privileged operation the renderer can reach is declared here.
 * Nothing else calls ipcMain.handle, so the attack surface stays in one file.
 */
export function registerIpc(deps: IpcDeps): void {
  const { settings, overlay, saver, hotkeys, log } = deps

  // ── Overlay ─────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.OVERLAY_READY, () => {
    overlay.markReady()
  })

  ipcMain.handle(CHANNELS.OVERLAY_CANCEL, () => {
    overlay.close('cancelled by user')
  })

  ipcMain.handle(CHANNELS.OVERLAY_COMMIT, async (_event, request: CommitRequest): Promise<CommitResult> => {
    const parent = overlay.window

    const result = await saver.commit(request, parent, (fn) => overlay.withModal(fn))

    // If the save was cancelled, keep the overlay open so the user can retry.
    const cancelled = !result.ok && !result.error
    if (!cancelled) {
      overlay.close(`committed (${request.action})`)
    }

    if (result.ok) {
      notify(deps, {
        tone: 'success',
        text: result.filePath ? t('notice.saved') : t('notice.copied'),
        path: result.filePath,
      })
    } else if (result.error) {
      notify(deps, { tone: 'error', text: result.error })
    }

    return result
  })

  // ── Settings ────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.SETTINGS_GET, () => ({
    values: settings.all(),
    hotkeyStatus: hotkeys.current,
    version: app.getVersion(),
  }))

  ipcMain.handle(CHANNELS.SETTINGS_SET, (_event, patch: Partial<SnapSettings>) => {
    const before = { ...settings.all() }
    settings.set(patch)
    const changed = (Object.keys(patch) as Array<keyof SnapSettings>).filter(
      (k) => before[k] !== settings.all()[k],
    )
    if (changed.length > 0) deps.onSettingsChanged(changed)
    return { values: settings.all(), hotkeyStatus: hotkeys.current }
  })

  ipcMain.handle(CHANNELS.SETTINGS_RESET, () => {
    settings.reset()
    deps.onSettingsChanged(Object.keys(settings.all()) as Array<keyof SnapSettings>)
    return { values: settings.all(), hotkeyStatus: hotkeys.current }
  })

  ipcMain.handle(CHANNELS.SETTINGS_PICK_DIR, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: t('dialog.chooseSaveFolder'),
      defaultPath: settings.get('saveDirectory'),
      properties: ['openDirectory', 'createDirectory'],
    }

    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── App ─────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.APP_OPEN_LOGS, () => {
    log.openDirectory()
  })

  ipcMain.handle(CHANNELS.APP_OPEN_PATH, async (_event, target: string) => {
    if (typeof target !== 'string' || !target) return

    // Reveal files in Explorer; open folders directly.
    if (/\.(png|jpe?g)$/i.test(target)) {
      shell.showItemInFolder(target)
    } else {
      await shell.openPath(target)
    }
  })

  ipcMain.handle(CHANNELS.APP_VERSION, () => app.getVersion())

  // ── Window controls (frameless settings window) ─────────────────────────

  ipcMain.handle(CHANNELS.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(CHANNELS.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

/** Broadcasts a toast to every open window. */
function notify(deps: IpcDeps, message: { tone: 'success' | 'error' | 'info'; text: string; path?: string }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(EVENTS.TOAST, message)
  }
  deps.log.debug(`Toast: [${message.tone}] ${message.text}`)
}
