import { ipcMain, ipcRenderer, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'

/**
 * Contract mapping a channel name to its (request, response) types.
 *
 * An app declares one like this:
 *   interface SnapContract {
 *     'capture:region': { req: void; res: CaptureResult }
 *     'settings:get':   { req: void; res: Settings }
 *   }
 */
export type IpcContract = Record<string, { req: unknown; res: unknown }>

/** Registers an invoke handler in the main process; channel and types come from the contract. */
export function handle<C extends IpcContract, K extends keyof C & string>(
  channel: K,
  fn: (req: C[K]['req'], event: IpcMainInvokeEvent) => C[K]['res'] | Promise<C[K]['res']>,
): void {
  ipcMain.handle(channel, (event, req) => fn(req as C[K]['req'], event))
}

/** Typed invoke from the renderer. Normally called from the preload script. */
export function invoke<C extends IpcContract, K extends keyof C & string>(
  channel: K,
  req: C[K]['req'],
): Promise<C[K]['res']> {
  return ipcRenderer.invoke(channel, req) as Promise<C[K]['res']>
}

/**
 * One-way event broadcast from the main process to renderers.
 * Skips windows that have already been destroyed.
 */
export function broadcast(windows: Array<BrowserWindow | null | undefined>, channel: string, payload?: unknown): void {
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

/**
 * Subscribes to an event in the renderer; returns an unsubscribe function.
 * Exposed on `window.api` from the preload script.
 */
export function on(channel: string, listener: (payload: unknown) => void): () => void {
  const wrapped = (_event: unknown, payload: unknown) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}
