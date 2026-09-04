import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { Logger, atomicWrite, readJson, resourcePath } from '@garam/core'
import {
  CHANNELS,
  NOTE_EXTENSION,
  type DialogResult,
  type NoteFileHeader,
  type OpenResult,
  type SaveResult,
} from '@shared/types'

let mainWindow: BrowserWindow | null = null
let log: Logger

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#14142a',
    icon: resourcePath('icons', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    CHANNELS.FILE_SAVE,
    async (_event, filePath: string, data: unknown): Promise<SaveResult> => {
      try {
        // atomicWrite puts the temp file in the TARGET directory. The previous
        // implementation wrote to os.tmpdir() and renamed across volumes, which
        // is not atomic and outright fails when the note lives on another drive.
        await atomicWrite(filePath, JSON.stringify(data, null, 2))
        return { success: true }
      } catch (error) {
        log.error('Could not save note', error)
        return { success: false, error: (error as Error).message }
      }
    },
  )

  ipcMain.handle(CHANNELS.FILE_OPEN, async (_event, filePath: string): Promise<OpenResult> => {
    // readJson strips a leading BOM; a bare JSON.parse throws on one.
    const data = await readJson<(NoteFileHeader & Record<string, unknown>) | null>(filePath, null)

    if (!data || !data.appVersion || !data.documentVersion) {
      log.warn(`Not a valid .${NOTE_EXTENSION} file: ${filePath}`)
      return { success: false, error: `Invalid .${NOTE_EXTENSION} file format` }
    }

    return { success: true, data }
  })

  ipcMain.handle(CHANNELS.FILE_SAVE_DIALOG, async (): Promise<DialogResult> => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save Note',
      defaultPath: `untitled.${NOTE_EXTENSION}`,
      filters: [
        { name: 'G-Note Files', extensions: [NOTE_EXTENSION] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    return { canceled: result.canceled, filePath: result.filePath }
  })

  ipcMain.handle(CHANNELS.FILE_OPEN_DIALOG, async (): Promise<DialogResult> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open Note',
      filters: [
        { name: 'G-Note Files', extensions: [NOTE_EXTENSION] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    return { canceled: result.canceled, filePath: result.filePaths[0] }
  })
}

app.whenReady().then(() => {
  log = new Logger()
  log.info(`G-Note ${app.getVersion()} starting (Electron ${process.versions.electron})`)

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (err) => log?.error('Uncaught exception', err))
process.on('unhandledRejection', (reason) => log?.error('Unhandled promise rejection', reason))
