import type { ReactNode } from 'react'
import { cx } from '../cx'

export interface TitleBarProps {
  title: string
  /** Baslikta gosterilecek ikon (or. uygulama logosu). */
  icon?: ReactNode
  /** Basligin sagindaki serbest alan (sekmeler, durum rozeti...). */
  children?: ReactNode
  /** Pencere kontrollerini gizle (or. arac penceresi). */
  hideControls?: boolean
  /** Buyutme dugmesini gizle (yeniden boyutlandirilamayan pencereler). */
  hideMaximize?: boolean
  onMinimize?: () => void
  onMaximize?: () => void
  onClose?: () => void
  className?: string
}

/**
 * Cercevesiz Electron pencereleri icin ortak baslik cubugu.
 * `-webkit-app-region: drag` .g-drag ile geliyor; icindeki tiklanabilir
 * ogelerin .g-no-drag tasimasi gerekiyor.
 */
export function TitleBar({
  title,
  icon,
  children,
  hideControls,
  hideMaximize,
  onMinimize,
  onMaximize,
  onClose,
  className,
}: TitleBarProps) {
  return (
    <header className={cx('g-titlebar', 'g-drag', className)}>
      {icon && <span className="g-titlebar__icon">{icon}</span>}
      <span className="g-titlebar__title">{title}</span>
      <div className="g-titlebar__slot g-no-drag">{children}</div>
      {!hideControls && (
        <div className="g-titlebar__controls g-no-drag">
          <button className="g-winbtn" aria-label="Simge durumuna kucult" onClick={onMinimize}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
            </svg>
          </button>
          {!hideMaximize && (
            <button className="g-winbtn" aria-label="Buyut" onClick={onMaximize}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
              </svg>
            </button>
          )}
          <button className="g-winbtn g-winbtn--close" aria-label="Kapat" onClick={onClose}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" fill="none" />
            </svg>
          </button>
        </div>
      )}
    </header>
  )
}
