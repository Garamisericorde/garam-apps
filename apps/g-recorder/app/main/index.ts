import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron'
import { join, resolve } from 'path'
import { existsSync, rmSync } from 'fs'
import { electronApp, is } from '@electron-toolkit/utils'
import { violetSurfaces } from '@garam/theme'
import { logger } from './logging/logger'
import { registerSystemAudioHandler } from './audio/SystemAudioBridge'
import { localTimestamp } from '../shared/time'
import type { CloseChoice, CloseRequest } from '../shared/types'
import { SettingsStore } from './settings/SettingsStore'
import { FfmpegManager } from './ffmpeg/FfmpegManager'
import { RecorderService } from './ffmpeg/RecorderService'
import { cleanThumbnailCache } from './ffmpeg/MediaProbe'
import { isSaving, runSaveReplay } from './ffmpeg/saveReplayPipeline'
import { announce, announceReplaySaved, registerRecorderIpc } from './ipc/recorderIpc'
import { registerExportIpc } from './ipc/exportIpc'
import { registerSettingsIpc } from './ipc/settingsIpc'
import { registerMediaIpc } from './ipc/mediaIpc'
import { registerGamepadIpc } from './ipc/gamepadIpc'
import { broadcast } from './ipc/broadcast'
import { registerClipProtocolHandler, registerClipScheme } from './protocol/clipProtocol'
import { TrayController } from './tray/TrayController'
import { HotkeyManager } from './hotkeys/HotkeyManager'
import { GamepadHotkeys } from './hotkeys/GamepadHotkeys'
import { OverlayWindow } from './overlay/OverlayWindow'

let mainWindow: BrowserWindow | null = null
let tray: TrayController | null = null
let hotkeys: HotkeyManager | null = null
let padHotkeys: GamepadHotkeys | null = null
let overlay: OverlayWindow | null = null
let isQuitting = false

// Must happen before the app is ready — see clipProtocol for why.
registerClipScheme()

// A second instance would fight over the cache, hotkeys, and tray icon.
if (!app.requestSingleInstanceLock()) {
  logger.info('Another instance is already running, exiting')
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  void start()
}

// ─────────────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await app.whenReady()

  // Packaged only. Windows resolves a taskbar icon through the AppUserModelID's
  // registered shortcut, which exists once the app is installed — setting the
  // ID without one makes Windows fall back to the host executable's icon and
  // *overrides* the icon the window sets for itself. In development that host
  // is electron.exe, so the ID is exactly what pins Electron's logo there.
  if (app.isPackaged) electronApp.setAppUserModelId('com.garam.g-recorder')

  const settings = SettingsStore.getInstance()
  await settings.load()

  cleanThumbnailCache()
  registerClipProtocolHandler()

  registerRecorderIpc()
  registerExportIpc()
  registerSettingsIpc()
  registerMediaIpc(() => mainWindow)
  registerGamepadIpc(() => padHotkeys)

  createMainWindow()
  createTray()
  createOverlay()
  registerHotkeys()
  watchRecorderStatus()

  settings.onChange((updated, changedKeys) => {
    if (changedKeys.some((key) => key.startsWith('hotkey') || key.startsWith('pad'))) {
      registerHotkeys()
    }
    if (changedKeys.includes('showOverlay')) overlay?.setVisible(updated.showOverlay)
  })

  // FFmpeg resolution is slow enough to be worth keeping off the startup path
  void prepareFfmpeg()

  logger.info('App ready')
}

/** Locate FFmpeg, then start the replay buffer if the user wants it always on */
async function prepareFfmpeg(): Promise<void> {
  const status = await FfmpegManager.getInstance().ensureReady()

  if (status.state !== 'ready') {
    logger.warn('FFmpeg is unavailable, recording is disabled until it is installed')
    return
  }

  if (!SettingsStore.getInstance().get().autoStartRecording) return

  try {
    await RecorderService.getInstance().start()
  } catch (err) {
    logger.error('Could not auto-start the replay buffer', String(err))
  }
}

// ── Windows ──────────────────────────────────────────────────────────────────

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: violetSurfaces.bg,
    autoHideMenuBar: true,
    icon: resolve(app.getAppPath(), 'resources', 'icons', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      // This window captures system audio while the buffer runs, and it spends
      // most of that time hidden behind a game. Chromium throttles hidden
      // windows hard enough to break the audio graph, so it must not.
      backgroundThrottling: false,
    },
  })

  applyWindowIcon(mainWindow)
  registerSystemAudioHandler(mainWindow)

  // Launching at login (or with --hidden) should not steal focus
  const startHidden = process.argv.includes('--hidden')
  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  /*
   * Minimize gets out of the way; the close button closes.
   *
   * They mean different things and the app now says so. Minimize hides to the
   * tray with everything still running, which is the gesture for "keep
   * recording, I am playing". The close button ends the app, and asks first
   * whenever ending it would stop a capture.
   */
  // 'minimize' fires after the fact and cannot be prevented, so the window is
  // hidden from under it: the taskbar button goes, the tray icon stays.
  mainWindow.on('minimize', () => mainWindow?.hide())

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    void confirmClose()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Report the palette the window actually resolved. "The theme did not change"
  // and "the stylesheet did not load" look identical from the outside, and the
  // renderer is the only place that can tell them apart.
  mainWindow.webContents.once('did-finish-load', () => {
    void mainWindow?.webContents
      .executeJavaScript(
        `(() => { const s = getComputedStyle(document.documentElement);
          return { accent: s.getPropertyValue('--accent').trim(),
                   bg: s.getPropertyValue('--bg').trim(), url: location.href } })()`,
      )
      .then((palette) => logger.info('Renderer palette', palette))
      .catch(() => undefined)
  })

  logger.info('Main window created')
}

/**
 * Set the window icon explicitly, from the .ico.
 *
 * The `icon` constructor option takes the 256px PNG, which Windows then has to
 * downscale for the taskbar; the .ico carries purpose-drawn 16 and 32px frames
 * and is what the installed app uses, so both paths end up identical. The
 * result is logged because a missing or unreadable file fails silently — the
 * window simply keeps the host executable's icon, which in development is
 * Electron's own and reads as "the icon change did not work".
 */
function applyWindowIcon(window: BrowserWindow): void {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'icons', 'icon.ico')
    : resolve(app.getAppPath(), 'resources', 'icons', 'icon.ico')

  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) {
    logger.warn('Window icon could not be loaded', { path, exists: existsSync(path) })
    return
  }

  window.setIcon(image)
  logger.info('Window icon applied', { path })
}

function showMainWindow(route?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    mainWindow?.once('ready-to-show', () => {
      mainWindow?.show()
      if (route) broadcast('app:navigate', route)
    })
    return
  }

  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  if (route) broadcast('app:navigate', route)
}

function createOverlay(): void {
  overlay = new OverlayWindow()
  if (SettingsStore.getInstance().get().showOverlay) overlay.create()
}

// ── Tray ─────────────────────────────────────────────────────────────────────

function createTray(): void {
  const recorder = RecorderService.getInstance()

  tray = new TrayController({
    openWindow: () => toggleMainWindow(),
    openSettings: () => showMainWindow('/settings'),
    toggleReplayBuffer: () => {
      const status = recorder.getStatus()
      void runGuarded(status.isRecording ? recorder.stop() : recorder.start())
    },
    saveReplay: () => void handleSaveReplay(),
    toggleManualRecording: () => void handleToggleManualRecording(),
    openOutputFolder: () => {
      void shell.openPath(SettingsStore.getInstance().get().outputPath)
    },
    quit: () => void quit(),
  })

  tray.update(recorder.getStatus())
}

/**
 * Close the app, after asking about anything it would interrupt.
 *
 * Closing while a capture runs is the one destructive thing this window does,
 * and it is one click from everything else. A recording in progress gets the
 * full three answers, because "close without saving" is a real thing to want
 * and losing the take by accident is not.
 */
async function confirmClose(): Promise<void> {
  const recorder = RecorderService.getInstance()
  const status = recorder.getStatus()

  if (status.isManualRecording) {
    const choice = await askAboutClosing({ kind: 'recording' })
    if (choice === 'cancel') return

    try {
      const outputPath = await recorder.stopManualRecording()
      if (choice === 'discard' && outputPath) {
        // "Discard" has to mean it. Leaving the file behind would be the app
        // deciding it knew better than the button that was pressed.
        rmSync(outputPath, { force: true })
        logger.info('Recording discarded on close', { outputPath })
      } else if (outputPath) {
        announceReplaySaved(outputPath, 0)
      }
    } catch (err) {
      logger.error('Could not stop the recording while closing', String(err))
    }

    await quit()
    return
  }

  if (status.isRecording) {
    if ((await askAboutClosing({ kind: 'buffer' })) === 'cancel') return
  }

  await quit()
}

/**
 * Put the question to the renderer, in the app's own dressing.
 *
 * A native message box is the one place a themed app suddenly looks like
 * something else, and it would appear on the way out, over a window the user
 * has been looking at all evening.
 *
 * Falls back to closing rather than hanging: a renderer that cannot answer (no
 * window, a crashed page) must not leave the app impossible to quit. The
 * timeout is the same reasoning.
 */
async function askAboutClosing(request: CloseRequest): Promise<CloseChoice> {
  const window = mainWindow
  if (!window || window.isDestroyed()) return 'close'

  // The question is on that window, so it has to be in front of the user.
  if (!window.isVisible()) window.show()
  if (window.isMinimized()) window.restore()
  window.focus()

  return new Promise<CloseChoice>((resolve) => {
    let settled = false

    const finish = (choice: CloseChoice): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ipcMain.removeListener('app:closeChoice', onChoice)
      resolve(choice)
    }

    const onChoice = (_event: unknown, choice: CloseChoice): void => finish(choice)
    const timer = setTimeout(() => {
      logger.warn('Close confirmation went unanswered; closing anyway')
      finish('close')
    }, 30_000)

    ipcMain.on('app:closeChoice', onChoice)
    window.webContents.send('app:confirmClose', request)
  })
}

function toggleMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide()
    return
  }
  showMainWindow()
}

function watchRecorderStatus(): void {
  // The IPC layer already broadcasts to renderers; this keeps the tray in sync.
  RecorderService.getInstance().onStatusChange((status) => tray?.update(status))
}

// ── Hotkeys ──────────────────────────────────────────────────────────────────

function registerHotkeys(): void {
  const actions = {
    saveReplay: () => void handleSaveReplay(),
    recordToFile: () => void handleToggleManualRecording(),
    toggleRecording: () => {
      const recorder = RecorderService.getInstance()
      const status = recorder.getStatus()
      void runGuarded(status.isRecording ? recorder.stop() : recorder.start())
    },
  }

  hotkeys ??= new HotkeyManager(actions)
  // Same three actions, reached from the pad. Registering both every time is
  // what keeps a changed binding live without a restart.
  padHotkeys ??= new GamepadHotkeys(actions)
  padHotkeys.register()

  const result = hotkeys.register()
  if (result.failed.length > 0) {
    broadcast('app:hotkeyConflict', result.failed)
  }
}

// ── Actions shared by the tray and the hotkeys ───────────────────────────────

async function handleSaveReplay(): Promise<void> {
  if (isSaving()) {
    logger.warn('Save replay ignored, one is already running')
    return
  }

  try {
    const { outputPath, durationSeconds } = await runSaveReplay()
    /*
     * No window is raised. The hotkey is pressed mid-game, and taking the
     * foreground is the one thing a replay recorder must never do; the line of
     * text is what says it worked.
     */
    announceReplaySaved(outputPath, durationSeconds)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Save replay failed', message)
    broadcast('app:notice', { level: 'error', message })
  }
}

async function handleToggleManualRecording(): Promise<void> {
  const recorder = RecorderService.getInstance()

  try {
    if (recorder.getStatus().isManualRecording) {
      const outputPath = await recorder.stopManualRecording()
      if (outputPath) {
        announce('Recording stopped')
        announceReplaySaved(outputPath, 0)
      }
      return
    }

    const settings = SettingsStore.getInstance().get()
    await recorder.startManualRecording(
      join(settings.outputPath, `recording ${localTimestamp()}.mp4`),
    )
    announce('Recording started')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Manual recording toggle failed', message)
    broadcast('app:notice', { level: 'error', message })
  }
}

/** Run a background action, surfacing failures to the UI instead of swallowing them */
async function runGuarded(work: Promise<unknown>): Promise<void> {
  try {
    await work
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Background action failed', message)
    broadcast('app:notice', { level: 'error', message })
  }
}

// ── Shutdown ─────────────────────────────────────────────────────────────────

async function quit(): Promise<void> {
  if (isQuitting) return
  isQuitting = true

  logger.info('Shutting down…')
  const recorder = RecorderService.getInstance()

  try {
    if (recorder.getStatus().isManualRecording) await recorder.stopManualRecording()
    await recorder.stop()
  } catch (err) {
    logger.warn('Error while stopping the recorder during shutdown', String(err))
  }

  app.quit()
}

// The tray keeps the app alive after every window is closed.
app.on('window-all-closed', () => {
  // Intentionally empty — quitting happens through the tray or app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  hotkeys?.unregister()
  padHotkeys?.stop()
  tray?.destroy()
  overlay?.destroy()
})
