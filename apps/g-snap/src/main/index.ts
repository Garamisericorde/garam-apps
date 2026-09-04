import { app } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { Logger, SettingsStore } from '@garam/core'
import type { SnapSettings } from '@shared/types'
import { createDefaults, SETTINGS_VERSION } from './settings/defaults.js'
import { OverlayController } from './overlay/OverlayWindow.js'
import { SettingsWindowController } from './windows/SettingsWindow.js'
import { HotkeyManager } from './hotkeys/HotkeyManager.js'
import { TrayController } from './tray/TrayController.js'
import { SaveService } from './output/SaveService.js'
import { registerIpc } from './ipc/registerIpc.js'
import { captureActiveDisplayImage } from './capture/ScreenCapture.js'
import { setLaunchAtStartup } from './settings/startup.js'
import { ffiFailure } from './native/ffi.js'
import { setLocale } from '@shared/i18n/index.js'

// Ask Chromium for the modern Windows capturers. The default screen capturer
// is GDI-based and cannot see a game running in exclusive fullscreen; Windows
// Graphics Capture and the DirectX capturer can. Unknown feature names are
// ignored, so listing several costs nothing.
app.commandLine.appendSwitch(
  'enable-features',
  'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcDesktopCapturer,AllowWgcScreenCapturer,AllowWgcDesktopCapturer',
)

// Single-instance lock: a second launch opens Settings on the running
// instance and exits.
const gotLock = app.requestSingleInstanceLock()

// G-Snap is a windowless tray app; closing every window must not quit it.
app.on('window-all-closed', () => {
  // Deliberately empty: quitting happens only via the tray menu or app.quit().
})

let log: Logger
let settings: SettingsStore<SnapSettings>
let overlay: OverlayController
let settingsWindow: SettingsWindowController
let hotkeys: HotkeyManager
let tray: TrayController
let saver: SaveService

async function bootstrap(): Promise<void> {
  log = new Logger()
  log.info(`G-Snap ${app.getVersion()} starting (Electron ${process.versions.electron})`)

  // Losing the FFI is survivable but changes how the app behaves, so say it
  // once, here, rather than leaving the user to wonder why capture got slow and
  // PrintScreen started lagging.
  const nativeError = ffiFailure()
  if (nativeError) {
    log.warn(
      'Native layer unavailable — running on fallbacks: capture goes through ' +
        'desktopCapturer (~350 ms instead of ~58 ms) and PrintScreen through ' +
        `globalShortcut. Reinstalling usually fixes it. Reason: ${nativeError}`,
    )
  }

  settings = new SettingsStore<SnapSettings>({
    defaults: createDefaults(),
    version: SETTINGS_VERSION,
    fileName: 'settings.json',
  })
  await settings.load()
  log.debug(`Settings loaded: ${settings.path}`)

  // Before the tray, the dialogs or the windows exist: each of them builds its
  // strings once, at construction, and never asks again.
  setLocale(settings.get('language'))

  saver = new SaveService(settings, log)
  settingsWindow = new SettingsWindowController()

  overlay = new OverlayController(log, () => ({
    color: settings.get('defaultColor'),
    thickness: settings.get('defaultThickness'),
  }))

  hotkeys = new HotkeyManager(log, {
    onRegion: () => void captureRegion(),
    onFullscreen: () => void captureFullscreen(),
  })

  tray = new TrayController(log, {
    onCaptureRegion: () => void captureRegion('tray'),
    onCaptureFullscreen: () => void captureFullscreen(),
    onOpenSettings: () => settingsWindow.show(),
    onOpenSaveFolder: () => void openSaveFolder(),
    onQuit: () => quit(),
  })

  registerIpc({
    settings,
    overlay,
    saver,
    hotkeys,
    log,
    onSettingsChanged: handleSettingsChanged,
  })

  applyHotkeys()
  tray.create(currentHotkeyLabels())
  applyLaunchAtStartup()

  // Build the overlay window now, hidden. Creating a full-screen window and
  // loading the renderer costs a few hundred ms; paying it here means the
  // hotkey only has to wait for the capture itself.
  overlay.prewarm()

  // The logon task passes --hidden and wants a silent tray start. Anything
  // else — the Start menu shortcut, the desktop icon, the launch the installer
  // performs — is a person asking for the app, and a tray app that shows
  // absolutely nothing when you run it looks like it failed to start.
  if (!process.argv.includes('--hidden')) settingsWindow.show()

  log.info('Ready — capture from the tray icon or a hotkey')
}

/** Region capture: opens the selection overlay. */
async function captureRegion(source = 'hotkey'): Promise<void> {
  try {
    await overlay.open(source)
  } catch (err) {
    log.error('Region capture failed', err)
  }
}

/** Full screen: copies straight to the clipboard. No overlay, no disk write. */
async function captureFullscreen(): Promise<void> {
  try {
    const image = await captureActiveDisplayImage()
    saver.copyToClipboardDirect(image)
  } catch (err) {
    log.error('Full-screen capture failed', err)
  }
}

async function openSaveFolder(): Promise<void> {
  const { shell } = await import('electron')
  const { promises: fs } = await import('node:fs')
  const dir = settings.get('saveDirectory')

  // The folder will not exist until something is saved; create it first.
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  await shell.openPath(dir)
}

function currentHotkeyLabels(): { region: string; fullscreen: string } {
  return {
    region: settings.get('hotkeyRegion'),
    fullscreen: settings.get('hotkeyFullscreen'),
  }
}

function applyHotkeys(): void {
  hotkeys.apply({
    hotkeyRegion: settings.get('hotkeyRegion'),
    hotkeyFullscreen: settings.get('hotkeyFullscreen'),
  })
}

function applyLaunchAtStartup(): void {
  // Writes a persistent OS entry, so only for the packaged app.
  if (!app.isPackaged) return

  const enabled = settings.get('launchAtStartup')
  void setLaunchAtStartup(enabled).then((ok) => {
    if (ok) {
      log.info(`Launch at startup ${enabled ? 'enabled' : 'disabled'}`)
    } else if (enabled) {
      log.warn('Could not register the startup task; the app will not auto-start')
    }
  })
}

function handleSettingsChanged(changed: Array<keyof SnapSettings>): void {
  if (changed.includes('hotkeyRegion') || changed.includes('hotkeyFullscreen')) {
    applyHotkeys()
    tray.update(currentHotkeyLabels())
  }

  if (changed.includes('launchAtStartup')) {
    applyLaunchAtStartup()
  }

  if (changed.includes('language')) {
    // The tray menu is built from strings, so it has to be rebuilt. The two
    // renderers re-render themselves from the snapshot they get back.
    setLocale(settings.get('language'))
    tray.update(currentHotkeyLabels())
  }
}

function quit(): void {
  log?.info('Quit requested')
  void shutdown().finally(() => app.exit(0))
}

async function shutdown(): Promise<void> {
  hotkeys?.dispose()
  overlay?.destroy()
  tray?.destroy()
  await settings?.flush()
  await log?.close()
}

// ── App lifecycle ──────────────────────────────────────────────────────────

if (!gotLock) {
  // Another instance already owns the lock. Exit without bootstrapping —
  // otherwise a half-initialised app fights over the tray and hotkeys.
  app.quit()
} else {
  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.garam.g-snap')
    await bootstrap()
  })

  app.on('second-instance', () => {
    settingsWindow?.show()
  })
}

app.on('before-quit', () => {
  hotkeys?.dispose()
})

// Never swallow unhandled errors silently.
//
// NOTE: this only covers what happens after this file has been evaluated. An
// exception thrown while the import graph is still loading lands before any of
// this is registered, and the user gets Electron's raw error dialog with
// nothing written to the log — which is exactly what a native module that
// could not be required used to do. Hence ./native/ffi.ts: that import must
// not be able to throw in the first place.
process.on('uncaughtException', (err) => {
  log?.error('Uncaught exception', err)
})

process.on('unhandledRejection', (reason) => {
  log?.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)))
})

process.on('unhandledRejection', (reason) => {
  log?.error('Unhandled promise rejection', reason)
})
