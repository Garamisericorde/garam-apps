import { ipcMain, ipcRenderer, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'

/**
 * Kanal adi -> (istek, yanit) esleme sozlesmesi.
 *
 * Uygulamada boyle tanimlanir:
 *   interface SnapContract {
 *     'capture:region': { req: void; res: CaptureResult }
 *     'settings:get':   { req: void; res: Settings }
 *   }
 */
export type IpcContract = Record<string, { req: unknown; res: unknown }>

/** Ana surecte bir invoke isleyicisi kaydeder — kanal ve tipler sozlesmeden gelir. */
export function handle<C extends IpcContract, K extends keyof C & string>(
  channel: K,
  fn: (req: C[K]['req'], event: IpcMainInvokeEvent) => C[K]['res'] | Promise<C[K]['res']>,
): void {
  ipcMain.handle(channel, (event, req) => fn(req as C[K]['req'], event))
}

/** Renderer tarafindan tipli invoke. Genelde preload icinden cagrilir. */
export function invoke<C extends IpcContract, K extends keyof C & string>(
  channel: K,
  req: C[K]['req'],
): Promise<C[K]['res']> {
  return ipcRenderer.invoke(channel, req) as Promise<C[K]['res']>
}

/**
 * Ana suructen renderer'a tek yonlu olay yayini.
 * Yok edilmis pencerelere gondermeyi atlar.
 */
export function broadcast(windows: Array<BrowserWindow | null | undefined>, channel: string, payload?: unknown): void {
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

/**
 * Renderer'da olay dinler; temizleyici fonksiyon doner.
 * Preload icinden `window.api` uzerine acilir.
 */
export function on(channel: string, listener: (payload: unknown) => void): () => void {
  const wrapped = (_event: unknown, payload: unknown) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}
