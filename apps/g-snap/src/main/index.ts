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
import { captureActiveDisplay } from './capture/ScreenCapture.js'

// Tek ornek kilidi: ikinci calistirma mevcut ornege ayarlari actirip cikar.
const gotLock = app.requestSingleInstanceLock()

// G-Snap penceresiz bir tepsi uygulamasi; tum pencereler kapaninca cikmamali.
app.on('window-all-closed', () => {
  // Bilerek bos: cikis yalnizca tepsi menusunden veya app.quit() ile.
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
  log.info(`G-Snap ${app.getVersion()} baslatiliyor (Electron ${process.versions.electron})`)

  settings = new SettingsStore<SnapSettings>({
    defaults: createDefaults(),
    version: SETTINGS_VERSION,
    fileName: 'settings.json',
  })
  await settings.load()
  log.debug(`Ayarlar yuklendi: ${settings.path}`)

  saver = new SaveService(settings, log)
  settingsWindow = new SettingsWindowController()

  overlay = new OverlayController(log, () => ({
    color: settings.get('defaultColor'),
    thickness: settings.get('defaultThickness'),
    showMagnifier: settings.get('showMagnifier'),
  }))

  hotkeys = new HotkeyManager(log, {
    onRegion: () => void captureRegion(),
    onFullscreen: () => void captureFullscreen(),
  })

  tray = new TrayController(log, {
    onCaptureRegion: () => void captureRegion(),
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

  log.info('Hazir — tepsiden veya kisayoldan yakalama yapabilirsiniz')
}

/** Bolge secimi: overlay'i acar. */
async function captureRegion(): Promise<void> {
  try {
    await overlay.open()
  } catch (err) {
    log.error('Bolge yakalama basarisiz', err)
  }
}

/** Tam ekran: overlay acmadan dogrudan panoya kopyalar. Diske yazmaz. */
async function captureFullscreen(): Promise<void> {
  try {
    const shot = await captureActiveDisplay()
    saver.copyToClipboardDirect(shot.dataUrl)
  } catch (err) {
    log.error('Tam ekran yakalama basarisiz', err)
  }
}

async function openSaveFolder(): Promise<void> {
  const { shell } = await import('electron')
  const { promises: fs } = await import('node:fs')
  const dir = settings.get('saveDirectory')

  // Henuz hicbir sey kaydedilmediyse klasor yoktur; olusturup acalim.
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
  // Gelistirmede acilista baslatmayi ayarlamak isletim sistemine kalici kayit
  // yazar; yalnizca paketlenmis uygulamada uygula.
  if (!app.isPackaged) return

  app.setLoginItemSettings({
    openAtLogin: settings.get('launchAtStartup'),
    args: ['--hidden'],
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
}

function quit(): void {
  log?.info('Cikis isteniyor')
  void shutdown().finally(() => app.exit(0))
}

async function shutdown(): Promise<void> {
  hotkeys?.dispose()
  overlay?.close()
  tray?.destroy()
  await settings?.flush()
  await log?.close()
}

// ── Uygulama yasam dongusu ─────────────────────────────────────────────────

if (!gotLock) {
  // Baska bir ornek zaten calisiyor. Kurulum yapmadan cik — aksi halde
  // bootstrap yarim calisip tepsi/kisayol kaydi cakisir.
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

// Yakalanmamis hatalar sessizce yutulmasin.
process.on('uncaughtException', (err) => {
  log?.error('Yakalanmamis istisna', err)
})

process.on('unhandledRejection', (reason) => {
  log?.error('Islenmemis promise reddi', reason)
})
