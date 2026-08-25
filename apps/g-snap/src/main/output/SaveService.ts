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
   * Overlay'den gelen goruntuyu ayarlara gore panoya kopyalar ve/veya kaydeder.
   *
   * `action`:
   *   copy    -> yalnizca panoya
   *   save    -> ayarlardaki klasore otomatik kaydet (askWhereToSave aciksa sorar)
   *   save-as -> her zaman konum sor
   */
  async commit(
    request: CommitRequest,
    parent: BrowserWindow | null,
    runModal: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<CommitResult> {
    const image = nativeImage.createFromDataURL(request.dataUrl)
    if (image.isEmpty()) {
      this.log.error('Gecersiz goruntu verisi alindi')
      return { ok: false, error: 'Goruntu olusturulamadi' }
    }

    const s = this.settings.all()

    // Kopyalama her zaman once yapilir: kaydetme iptal edilse bile pano dolar.
    if (request.action === 'copy' || s.copyToClipboard) {
      clipboard.writeImage(image)
      this.log.info(`Panoya kopyalandi (${request.rect.width}x${request.rect.height})`)
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
        this.log.debug('Kaydetme kullanici tarafindan iptal edildi')
        return { ok: false }
      }
      targetPath = chosen
    } else {
      targetPath = await this.nextAvailablePath(s)
    }

    try {
      await fs.mkdir(join(targetPath, '..'), { recursive: true })
      await fs.writeFile(targetPath, buffer)
      this.log.info(`Kaydedildi: ${targetPath}`)
      return { ok: true, filePath: targetPath }
    } catch (err) {
      this.log.error('Dosya yazilamadi', err)
      return { ok: false, error: 'Dosya yazilamadi. Klasor izinlerini kontrol edin.' }
    }
  }

  /**
   * Tam ekran yakalamayi DOGRUDAN PANOYA kopyalar (overlay acmadan, diske
   * yazmadan). Ctrl+PrintScreen'in tek isi bu; kaydetmek isteyen bolge
   * secimini kullanip Kaydet'e basar.
   */
  copyToClipboardDirect(dataUrl: string): CommitResult {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) {
      this.log.error('Tam ekran yakalamada gecersiz goruntu verisi')
      return { ok: false, error: 'Goruntu olusturulamadi' }
    }

    clipboard.writeImage(image)
    const size = image.getSize()
    this.log.info(`Tam ekran panoya kopyalandi (${size.width}x${size.height})`)
    return { ok: true }
  }

  /** Kaydedilen dosyayi Explorer'da secili halde acar. */
  revealInExplorer(filePath: string): void {
    shell.showItemInFolder(filePath)
  }

  private encode(image: Electron.NativeImage, s: SnapSettings): Buffer {
    return s.imageFormat === 'jpg' ? image.toJPEG(clampQuality(s.jpegQuality)) : image.toPNG()
  }

  private async askForPath(parent: BrowserWindow | null, s: SnapSettings): Promise<string | null> {
    const defaultPath = await this.nextAvailablePath(s)
    const options: Electron.SaveDialogOptions = {
      title: 'Ekran alintisini kaydet',
      defaultPath,
      filters:
        s.imageFormat === 'jpg'
          ? [{ name: 'JPEG goruntu', extensions: ['jpg', 'jpeg'] }]
          : [{ name: 'PNG goruntu', extensions: ['png'] }],
    }

    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)

    return result.canceled || !result.filePath ? null : result.filePath
  }

  /**
   * Sablondan dosya adi uretir; ayni saniyede birden fazla alinti alinirsa
   * uzerine yazmamak icin sonuna -2, -3 ... ekler.
   */
  private async nextAvailablePath(s: SnapSettings): Promise<string> {
    const ext = s.imageFormat === 'jpg' ? 'jpg' : 'png'
    const base = formatFileName(s.fileNameTemplate, { app: 'g-snap' })

    for (let n = 1; n <= 999; n++) {
      const name = n === 1 ? `${base}.${ext}` : `${base}-${n}.${ext}`
      const candidate = join(s.saveDirectory, name)
      try {
        await fs.access(candidate)
        // Dosya var, sonrakini dene.
      } catch {
        return candidate
      }
    }

    // 999 cakisma pratikte imkansiz; yine de bir yol dondurelim.
    return join(s.saveDirectory, `${base}-${Date.now()}.${ext}`)
  }
}

function clampQuality(value: number): number {
  if (!Number.isFinite(value)) return 90
  return Math.min(100, Math.max(1, Math.round(value)))
}
