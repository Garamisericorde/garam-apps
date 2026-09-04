import { useEffect, type ReactNode } from 'react'
import { cx } from '../cx'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Buttons shown in the footer. */
  footer?: ReactNode
  width?: number
  /** Do not close on backdrop click (e.g. unsaved-changes warning). */
  persistent?: boolean
  className?: string
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 420,
  persistent,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, persistent])

  if (!open) return null

  return (
    <div className="g-modal__scrim" onMouseDown={persistent ? undefined : onClose}>
      <div
        className={cx('g-modal', className)}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="g-modal__head">
          <h2 className="g-modal__title">{title}</h2>
        </div>
        <div className="g-modal__body">{children}</div>
        {footer && <div className="g-modal__foot">{footer}</div>}
      </div>
    </div>
  )
}
