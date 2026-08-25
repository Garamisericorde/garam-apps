/**
 * Minimal stand-in for the `electron` module.
 *
 * Several main-process modules touch Electron at import time (defaults.ts asks
 * for the Videos folder, logger.ts for userData). Aliasing the module keeps the
 * pure logic under test without pulling in a real Electron runtime.
 */

const PATHS: Record<string, string> = {
  userData: 'C:\\Users\\test\\AppData\\Roaming\\g-recorder',
  videos: 'C:\\Users\\test\\Videos',
  temp: 'C:\\Users\\test\\AppData\\Local\\Temp',
}

export const app = {
  isPackaged: false,
  getPath: (name: string): string => PATHS[name] ?? `C:\\Users\\test\\${name}`,
  getAppPath: (): string => 'C:\\g-recorder',
  getVersion: (): string => '0.0.0-test',
  getLoginItemSettings: () => ({ openAtLogin: false }),
  setLoginItemSettings: () => undefined,
  quit: () => undefined,
  on: () => undefined,
  whenReady: () => Promise.resolve(),
  requestSingleInstanceLock: () => true,
}

export const ipcMain = { handle: () => undefined, on: () => undefined }
export const webContents = { getAllWebContents: () => [] }
export const shell = { openPath: () => Promise.resolve(''), showItemInFolder: () => undefined }
export const dialog = { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) }
export const screen = { getPrimaryDisplay: () => ({ id: 1, size: { width: 1920, height: 1080 }, workAreaSize: { width: 1920, height: 1040 } }), getAllDisplays: () => [] }
export const globalShortcut = { register: () => true, unregisterAll: () => undefined }
export const protocol = { registerSchemesAsPrivileged: () => undefined, handle: () => undefined }
export const net = { request: () => undefined }

export const nativeImage = {
  createEmpty: () => ({ isEmpty: () => true, addRepresentation: () => undefined }),
  createFromPath: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
}

export const Tray = class {}
export const Menu = { buildFromTemplate: () => ({}) }
export const BrowserWindow = class {}
export const webUtils = { getPathForFile: () => '' }

export default {
  app,
  ipcMain,
  webContents,
  shell,
  dialog,
  screen,
  globalShortcut,
  protocol,
  net,
  nativeImage,
  Tray,
  Menu,
  BrowserWindow,
  webUtils,
}
