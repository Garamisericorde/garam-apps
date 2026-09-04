import { app, Menu, nativeImage, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import type { RecorderStatus } from '../../shared/types'
import { formatDuration } from '../../shared/time'
import { SettingsStore } from '../settings/SettingsStore'
import { logger } from '../logging/logger'

export interface TrayActions {
  openWindow: () => void
  openSettings: () => void
  toggleReplayBuffer: () => void
  saveReplay: () => void
  toggleManualRecording: () => void
  openOutputFolder: () => void
  quit: () => void
}

/**
 * The tray is the primary control surface — everything the app does is
 * reachable here without opening the window.
 */
export class TrayController {
  private tray: Tray | null = null
  private status: RecorderStatus | null = null

  constructor(private readonly actions: TrayActions) {
    this.create()
  }

  private create(): void {
    this.tray = new Tray(loadTrayIcon(false))
    this.tray.setToolTip('G-Recorder')
    this.tray.on('click', () => this.actions.openWindow())
    this.render()
    logger.info('Tray created')
  }

  /** Refresh the icon, tooltip, and menu to match the recorder state */
  update(status: RecorderStatus): void {
    this.status = status
    if (!this.tray) return

    this.tray.setImage(loadTrayIcon(status.isRecording || status.isManualRecording))
    this.tray.setToolTip(`G-Recorder — ${this.stateLabel()}`)
    this.render()
  }

  private stateLabel(): string {
    if (!this.status) return 'Starting…'
    if (this.status.error) return 'Error'
    if (this.status.isManualRecording) return 'Recording to file'
    if (this.status.isRecording) return `Replay buffer · ${formatDuration(this.status.bufferSeconds)}`
    return 'Idle'
  }

  private render(): void {
    if (!this.tray) return

    const status = this.status
    const bufferRunning = status?.isRecording ?? false
    const manualRunning = status?.isManualRecording ?? false
    const hotkeys = SettingsStore.getInstance().get()

    const template: MenuItemConstructorOptions[] = [
      { label: this.stateLabel(), enabled: false },
      { type: 'separator' },
      {
        label: bufferRunning ? 'Stop instant replay' : 'Start instant replay',
        enabled: !manualRunning,
        click: () => this.actions.toggleReplayBuffer(),
      },
      {
        label: 'Save replay',
        accelerator: hotkeys.hotkeySaveReplay,
        enabled: bufferRunning,
        click: () => this.actions.saveReplay(),
      },
      { type: 'separator' },
      {
        label: manualRunning ? 'Stop recording' : 'Record to file…',
        click: () => this.actions.toggleManualRecording(),
      },
      { type: 'separator' },
      { label: 'Open G-Recorder', click: () => this.actions.openWindow() },
      { label: 'Settings', click: () => this.actions.openSettings() },
      { label: 'Open clips folder', click: () => this.actions.openOutputFolder() },
      { type: 'separator' },
      { label: 'Exit', click: () => this.actions.quit() },
    ]

    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}

/**
 * Load the tray icon for a given state, falling back to a drawn placeholder if
 * the generated assets are missing (run `npm run icons` to create them).
 */
function loadTrayIcon(isRecording: boolean): Electron.NativeImage {
  const name = isRecording ? 'tray-recording' : 'tray-idle'
  const image = nativeImage.createEmpty()

  for (const size of [16, 32]) {
    const path = iconPath(`${name}-${size}.png`)
    if (!existsSync(path)) continue

    const representation = nativeImage.createFromPath(path)
    if (representation.isEmpty()) continue

    image.addRepresentation({
      scaleFactor: size / 16,
      width: size,
      height: size,
      buffer: representation.toPNG(),
    })
  }

  return image.isEmpty() ? nativeImage.createFromPath(iconPath('icon.png')) : image
}

function iconPath(filename: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', filename)
    : resolve(app.getAppPath(), 'resources', 'icons', filename)
}
