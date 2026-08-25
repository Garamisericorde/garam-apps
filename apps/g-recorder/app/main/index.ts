import { app, BrowserWindow, shell } from 'electron'
import { join, resolve } from 'path'
import { is } from '@electron-toolkit/utils'
import { logger } from './logging/logger'
import { localTimestamp } from '../shared/time'
import { SettingsStore } from './settings/SettingsStore'
import { FfmpegManager } from './ffmpeg/FfmpegManager'
import { RecorderService } from './ffmpeg/RecorderService'
import { cleanThumbnailCache } from './ffmpeg/MediaProbe'
import { isSaving, runSaveReplay } from './ffmpeg/saveReplayPipeline'
import { announceReplaySaved, registerRecorderIpc } from './ipc/recorderIpc'
import { registerExportIpc } from './ipc/exportIpc'
import { registerSettingsIpc } from './ipc/settingsIpc'
import { registerMediaIpc } from './ipc/mediaIpc'
import { broadcast } from './ipc/broadcast'
import { registerClipProtocolHandler, registerClipScheme } from './protocol/clipProtocol'
import { TrayController } from './tray/TrayController'
import { HotkeyManager } from './hotkeys/HotkeyManager'
import { OverlayWindow } from './overlay/OverlayWindow'

let mainWindow: BrowserWindow | null = null
let tray: TrayController | null = null
let hotkeys: HotkeyManager | null = null
let overlay: OverlayWindow | null = null
let isQuitting = false

// Must happen before the app is ready — see clipProtocol for why.
registerClipScheme()

// A second instance would fight over the cache, hotkeys, and tray icon.
if (!app.requestSingleInstanceLock()) {
  logger.info('Another instance is already running — exiting')
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  void start()
}

// ─────────────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await app.whenReady()

  const settings = SettingsStore.getInstance()
  await settings.load()

  cleanThumbnailCache()
  registerClipProtocolHandler()

  registerRecorderIpc()
  registerExportIpc()
  registerSettingsIpc()
  registerMediaIpc(() => mainWindow)

  createMainWindow()
  createTray()
  createOverlay()
  registerHotkeys()
  watchRecorderStatus()

  settings.onChange((updated, changedKeys) => {
    if (changedKeys.some((key) => key.startsWith('hotkey'))) registerHotkeys()
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
    logger.warn('FFmpeg is unavailable — recording is disabled until it is installed')
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
    backgroundColor: '#1a1a1f',
    autoHideMenuBar: true,
    icon: resolve(app.getAppPath(), 'resources', 'icons', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  // Launching at login (or with --hidden) should not steal focus
  const startHidden = process.argv.includes('--hidden')
  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  // Closing the window keeps the app alive in the tray — quitting is explicit
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
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

  logger.info('Main window created')
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
  if (!hotkeys) {
    hotkeys = new HotkeyManager({
      saveReplay: () => void handleSaveReplay(),
      toggleRecording: () => {
        const recorder = RecorderService.getInstance()
        const status = recorder.getStatus()
        void runGuarded(status.isRecording ? recorder.stop() : recorder.start())
      },
    })
  }

  const result = hotkeys.register()
  if (result.failed.length > 0) {
    broadcast('app:hotkeyConflict', result.failed)
  }
}

// ── Actions shared by the tray and the hotkeys ───────────────────────────────

async function handleSaveReplay(): Promise<void> {
  if (isSaving()) {
    logger.warn('Save replay ignored — one is already running')
    return
  }

  try {
    const { outputPath, durationSeconds } = await runSaveReplay()
    announceReplaySaved(outputPath, durationSeconds)
    showMainWindow('/editor')
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
        announceReplaySaved(outputPath, 0)
        showMainWindow('/editor')
      }
      return
    }

    const settings = SettingsStore.getInstance().get()
    await recorder.startManualRecording(
      join(settings.outputPath, `recording_${localTimestamp()}.mp4`),
    )
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
  tray?.destroy()
  overlay?.destroy()
})
