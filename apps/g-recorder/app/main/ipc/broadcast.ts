import { webContents } from 'electron'

/** Send a message to every live renderer (main window and overlay) */
export function broadcast(channel: string, payload?: unknown): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(channel, payload)
  }
}
