import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { basename, extname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { CHANNELS, type PickedImage } from '@shared/types'

/** What the file dialog offers, and how each maps into a data URL. */
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

/**
 * Every privileged operation the renderer can reach. One file, by house rule —
 * so the whole attack surface is readable in one screen.
 */
export function registerIpc(): void {
  const senderWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender)

  ipcMain.handle(CHANNELS.WINDOW_MINIMIZE, (event) => {
    senderWindow(event)?.minimize()
  })

  ipcMain.handle(CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const win = senderWindow(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle(CHANNELS.WINDOW_CLOSE, (event) => {
    senderWindow(event)?.close()
  })

  ipcMain.handle(CHANNELS.APP_VERSION, () => app.getVersion())

  /**
   * Reads the chosen bitmap here rather than handing the renderer a path.
   *
   * The renderer has no filesystem access by design, and a document that
   * referenced a path would break the moment the file moved. It comes back as a
   * data URL, which is what the document stores.
   */
  ipcMain.handle(CHANNELS.IMAGE_PICK, async (event): Promise<PickedImage | null> => {
    const win = senderWindow(event)
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Place image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      ],
    })
    const file = result.filePaths[0]
    if (result.canceled || !file) return null

    const mime = IMAGE_TYPES[extname(file).toLowerCase()]
    if (!mime) return null
    const bytes = await readFile(file)
    return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, name: basename(file) }
  })
}
