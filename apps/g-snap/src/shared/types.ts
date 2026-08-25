/** Piksel/DIP dikdortgeni. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Tek bir ekranin dondurulmus goruntusu. */
export interface DisplayShot {
  displayId: number
  /** Tum ekranlarin birlesik uzayindaki konum ve boyut (DIP). */
  bounds: Rect
  /**
   * Isletim sisteminin bildirdigi DPI olcegi (1 = %100, 1.5 = %150).
   * Bilgi amacli; olcek hesaplarinda `nativeSize` kullanilmali.
   */
  scaleFactor: number
  /**
   * Yakalanan goruntunun GERCEK piksel boyutu.
   *
   * Kesirli DPI olceginde `bounds * scaleFactor` tam sayi vermez ve gercek
   * piksel sayisindan 1 piksel sapabilir. Buyutec ve disa aktarma bu sapmayi
   * bulaniklik olarak gosterdigi icin olcek her yerde
   * `nativeSize.width / bounds.width` uzerinden hesaplanir.
   */
  nativeSize: { width: number; height: number }
  /** PNG data URL. */
  dataUrl: string
}

/** Bir ekran goruntusunun DIP -> gercek piksel olcegi. */
export function pixelScaleOf(shot: Pick<DisplayShot, 'bounds' | 'nativeSize'>): number {
  return shot.bounds.width > 0 ? shot.nativeSize.width / shot.bounds.width : 1
}

/** Overlay penceresine gonderilen acilis verisi. */
export interface OverlayInit {
  shots: DisplayShot[]
  /** Tum ekranlari kapsayan dikdortgen (DIP) — overlay penceresinin bounds'u. */
  union: Rect
  /** Varsayilan kalem rengi ve kalinligi (ayarlardan). */
  defaults: {
    color: string
    thickness: number
    showMagnifier: boolean
  }
}

export type ImageFormat = 'png' | 'jpg'

/** Secim tamamlaninca overlay'in ana surece gonderdigi istek. */
export interface CommitRequest {
  /** Kirpilmis ve anotasyonlari islenmis goruntu. */
  dataUrl: string
  /** Kaynak secim dikdortgeni (DIP) — gunluk ve dosya adi icin. */
  rect: Rect
  action: 'copy' | 'save' | 'save-as'
}

export interface CommitResult {
  ok: boolean
  /** Kaydedildiyse dosya yolu. */
  filePath?: string
  /** Basarisizsa kullaniciya gosterilecek mesaj. */
  error?: string
}

export interface SnapSettings {
  /** Bolge secimi kisayolu. */
  hotkeyRegion: string
  /** Tum ekrani dogrudan yakalama kisayolu. */
  hotkeyFullscreen: string

  /** Otomatik kaydetme klasoru. */
  saveDirectory: string
  /** Dosya adi sablonu — {YYYY} {MM} {DD} {HH} {mm} {ss} {app} {n} */
  fileNameTemplate: string
  imageFormat: ImageFormat
  /** JPEG kalitesi (1-100), yalnizca imageFormat 'jpg' iken kullanilir. */
  jpegQuality: number

  /** Bolge secimini onaylayinca otomatik panoya kopyala. */
  copyToClipboard: boolean
  /** Kaydederken her seferinde konum sor. */
  askWhereToSave: boolean

  /** Secim sirasinda piksel buyutec goster. */
  showMagnifier: boolean
  /** Windows ile birlikte baslat. */
  launchAtStartup: boolean

  /** Anotasyon varsayilanlari. */
  defaultColor: string
  defaultThickness: number
}

/** Ana surecin renderer'a yayinladigi olaylar. */
export const EVENTS = {
  OVERLAY_INIT: 'overlay:init',
  SETTINGS_CHANGED: 'settings:changed',
  TOAST: 'app:toast',
} as const

/** Renderer'in ana surece yaptigi invoke cagrilari. */
export const CHANNELS = {
  OVERLAY_READY: 'overlay:ready',
  OVERLAY_CANCEL: 'overlay:cancel',
  OVERLAY_COMMIT: 'overlay:commit',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_PICK_DIR: 'settings:pick-directory',
  SETTINGS_TEST_HOTKEY: 'settings:test-hotkey',
  APP_OPEN_LOGS: 'app:open-logs',
  APP_OPEN_PATH: 'app:open-path',
  APP_VERSION: 'app:version',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',
} as const

/** Kisayol kaydi sonucunu ayar penceresine bildirmek icin. */
export interface HotkeyStatus {
  hotkeyRegion: boolean
  hotkeyFullscreen: boolean
}

export interface ToastMessage {
  tone: 'success' | 'error' | 'info'
  text: string
  /** Varsa, tiklaninca acilacak dosya/klasor yolu. */
  path?: string
}
