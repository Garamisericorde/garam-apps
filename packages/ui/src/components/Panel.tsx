import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  title?: string
  description?: string
  /** Elements placed at the right of the header row. */
  actions?: ReactNode
}

/** Section card used on settings pages. */
export function Panel({ title, description, actions, className, children, ...rest }: PanelProps) {
  return (
    <section className={cx('g-panel', className)} {...rest}>
      {(title || actions) && (
        <div className="g-panel__head">
          <div>
            {title && <h2 className="g-panel__title">{title}</h2>}
            {description && <p className="g-panel__desc">{description}</p>}
          </div>
          {actions && <div className="g-panel__actions">{actions}</div>}
        </div>
      )}
      <div className="g-panel__body">{children}</div>
    </section>
  )
}
