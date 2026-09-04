import { t } from '@shared/i18n/index.js'
import { clipboard, dialog, nativeImage, shell, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { formatFileName, type Logger, type SettingsStore } from '@garam/core'
import type { CommitRequest, CommitResult, SnapSettings } from '@shared/types'

export class SaveService {
  constructor(
    private readonly settings: SettingsStore<SnapSettings>,
    private readonly log: Logger,
  ) {}

  /**
   * Copies and/or saves the image the overlay produced, per the settings.
   *
   * `action`:
   *   copy    -> clipboard only
   *   save    -> write to the configured folder (prompting if askWhereToSave)
   *   save-as -> always prompt for a location
   */
  async commit(
    request: CommitRequest,
    parent: BrowserWindow | null,
    runModal: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<CommitResult> {
    const image = nativeImage.createFromDataURL(request.dataUrl)
    if (image.isEmpty()) {
      this.log.error('Received invalid image data')
      return { ok: false, error: t('error.buildImage') }
    }

    const s = this.settings.all()

    // Copy first: even if the save is cancelled, the clipboard is filled.
    if (request.action === 'copy' || s.copyToClipboard) {
      clipboard.writeImage(image)
      this.log.info(`Copied to clipboard (${request.rect.width}x${request.rect.height})`)
    }

    if (request.action === 'copy') {
      return { ok: true }
    }

    const buffer = this.encode(image, s)
    const askUser = request.action === 'save-as' || s.askWhereToSave

    let targetPath: string
    if (askUser) {
      const chosen = await runModal(() => this.askForPath(parent, s))
      if (!chosen) {
        this.log.debug('Save cancelled by the user')
        return { ok: false }
      }
      targetPath = chosen
    } else {
      targetPath = await this.nextAvailablePath(s)
    }

    try {
      await fs.mkdir(join(targetPath, '..'), { recursive: true })
      await fs.writeFile(targetPath, buffer)
      this.log.info(`Saved: ${targetPath}`)
      return { ok: true, filePath: targetPath }
    } catch (err) {
      this.log.error('Could not write the file', err)
      return { ok: false, error: t('error.writeFile') }
    }
  }

  /**
   * Copies a full-screen capture STRAIGHT TO THE CLIPBOARD — no overlay, no
   * disk write. That is all Ctrl+PrintScreen does; anyone who wants a file uses
   * the region selection and presses Save.
   */
  copyToClipboardDirect(image: Electron.NativeImage): CommitResult {
    if (image.isEmpty()) {
      this.log.error('Invalid image data in the full-screen capture')
      return { ok: false, error: t('error.buildImage') }
    }

    clipboard.writeImage(image)
    const size = image.getSize()
    this.log.info(`Full screen copied to clipboard (${size.width}x${size.height})`)
    return { ok: true }
  }

  /** Reveals the saved file in Explorer. */
  revealInExplorer(filePath: string): void {
    shell.showItemInFolder(filePath)
  }

  private encode(image: Electron.NativeImage, s: SnapSettings): Buffer {
    return s.imageFormat === 'jpg' ? image.toJPEG(clampQuality(s.jpegQuality)) : image.toPNG()
  }

  private async askForPath(parent: BrowserWindow | null, s: SnapSettings): Promise<string | null> {
    const defaultPath = await this.nextAvailablePath(s)
    const options: Electron.SaveDialogOptions = {
      title: t('dialog.saveScreenshot'),
      defaultPath,
      filters:
        s.imageFormat === 'jpg'
          ? [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }]
          : [{ name: 'PNG image', extensions: ['png'] }],
    }

    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)

    return result.canceled || !result.filePath ? null : result.filePath
  }

  /**
   * Builds a name from the template, appending -2, -3 ... so two captures in
   * the same second do not overwrite each other.
   */
  private async nextAvailablePath(s: SnapSettings): Promise<string> {
    const ext = s.imageFormat === 'jpg' ? 'jpg' : 'png'
    const base = formatFileName(s.fileNameTemplate, { app: 'g-snap' })

    for (let n = 1; n <= 999; n++) {
      const name = n === 1 ? `${base}.${ext}` : `${base}-${n}.${ext}`
      const candidate = join(s.saveDirectory, name)
      try {
        await fs.access(candidate)
        // File exists, try the next one.
      } catch {
        return candidate
      }
    }

    // 999 collisions is not reachable in practice; still return something.
    return join(s.saveDirectory, `${base}-${Date.now()}.${ext}`)
  }
}

function clampQuality(value: number): number {
  if (!Number.isFinite(value)) return 90
  return Math.min(100, Math.max(1, Math.round(value)))
}
