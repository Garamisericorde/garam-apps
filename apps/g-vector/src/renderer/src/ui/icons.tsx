/**
 * Inline icons.
 *
 * All 16x16, all stroked with currentColor at 1.5, so a button's colour and
 * hover state carry through without the icon knowing anything about the theme.
 */
import type { ReactElement, ReactNode } from 'react'

function Glyph({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const SelectIcon = (): ReactElement => (
  <Glyph>
    <path d="M3 2.2 L12.2 8.4 L8.2 9.2 L10 13.4 L8.2 14.2 L6.4 10 L3.4 12.6 Z" />
  </Glyph>
)

export const RectIcon = (): ReactElement => (
  <Glyph>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
  </Glyph>
)

export const EllipseIcon = (): ReactElement => (
  <Glyph>
    <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />
  </Glyph>
)

export const DirectIcon = (): ReactElement => (
  <Glyph>
    <path d="M4 2.6 L11.6 8.2 L8.2 8.8 L9.6 12.6 L8.2 13.2 L6.8 9.4 L4.4 11.6 Z" />
  </Glyph>
)

export const PenIcon = (): ReactElement => (
  <Glyph>
    <path d="M7 2.4 L10.6 6 L8.4 12.4 L7 13.6 L5.6 12.4 L3.4 6 Z" />
    <path d="M5.6 12.4 L8.4 12.4" />
    <path d="M7 6.2 v3" />
  </Glyph>
)

export const CurvatureIcon = (): ReactElement => (
  <Glyph>
    <path d="M2.4 12 C 4.4 12, 4.6 4, 8 4 S 11.6 12, 13.6 12" />
    <circle cx="8" cy="4" r="1.5" />
  </Glyph>
)

export const HandIcon = (): ReactElement => (
  <Glyph>
    <path d="M5 8V4.2a1.2 1.2 0 0 1 2.4 0V8m0-.4V3.4a1.2 1.2 0 0 1 2.4 0V8m0-.6V4.6a1.2 1.2 0 0 1 2.4 0V9.6c0 2.4-1.6 4.4-4 4.4s-4-1.6-4-3.6V8.4a1.2 1.2 0 0 1 2.4 0" />
  </Glyph>
)

export const MagnetIcon = (): ReactElement => (
  <Glyph>
    <path d="M3.5 3v5a4.5 4.5 0 0 0 9 0V3" />
    <path d="M3.5 7.5h3.2M9.3 7.5h3.2" />
  </Glyph>
)

export const GridIcon = (): ReactElement => (
  <Glyph>
    <path d="M2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11" />
  </Glyph>
)

export const UndoIcon = (): ReactElement => (
  <Glyph>
    <path d="M5 5.5H9.8a3.7 3.7 0 0 1 0 7.4H6" />
    <path d="M7.2 3.2 4.6 5.6l2.6 2.4" />
  </Glyph>
)

export const RedoIcon = (): ReactElement => (
  <Glyph>
    <path d="M11 5.5H6.2a3.7 3.7 0 0 0 0 7.4H10" />
    <path d="M8.8 3.2l2.6 2.4-2.6 2.4" />
  </Glyph>
)

export const AppIcon = (): ReactElement => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1" y="1" width="14" height="14" rx="4" fill="url(#gv-app-icon)" />
    <rect x="9.4" y="9.4" width="3.2" height="3.2" rx="0.6" fill="#fff" />
    <path d="M11 9.4 V6.2 H7.2" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    <defs>
      <linearGradient id="gv-app-icon" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--accent-from)" />
        <stop offset="1" stopColor="var(--accent-to)" />
      </linearGradient>
    </defs>
  </svg>
)

/* ── Layer row glyphs ────────────────────────────────────────────────────── */

/** Deliberately 12px: these sit inside a 24px row, not on a toolbar. */
function Small({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const EyeIcon = (): ReactElement => (
  <Small>
    <path d="M1.6 8S4.2 3.6 8 3.6 14.4 8 14.4 8 11.8 12.4 8 12.4 1.6 8 1.6 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </Small>
)

export const EyeOffIcon = (): ReactElement => (
  <Small>
    <path d="M3 3.4 13 12.6" />
    <path d="M6.2 5.1C6.8 4.8 7.4 4.6 8 4.6c3.4 0 5.8 3.4 5.8 3.4a12 12 0 0 1-2.1 2.3" />
    <path d="M4.4 6.1A12.6 12.6 0 0 0 2.2 8s2.4 3.4 5.8 3.4c.6 0 1.2-.1 1.7-.3" />
  </Small>
)

export const LockIcon = (): ReactElement => (
  <Small>
    <rect x="3.6" y="7.2" width="8.8" height="6" rx="1.2" />
    <path d="M5.8 7.2V5.4a2.2 2.2 0 0 1 4.4 0v1.8" />
  </Small>
)

export const UnlockIcon = (): ReactElement => (
  <Small>
    <rect x="3.6" y="7.2" width="8.8" height="6" rx="1.2" />
    <path d="M5.8 7.2V5.4a2.2 2.2 0 0 1 4.2-.8" />
  </Small>
)

export const ImageIcon = (): ReactElement => (
  <Glyph>
    <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.4" />
    <path d="M2.8 10.6 6 7.8l2.6 2.2 2-1.6 2.6 2.2" />
    <circle cx="6" cy="6.2" r="0.9" />
  </Glyph>
)

export const PathGlyph = (): ReactElement => (
  <Small>
    <path d="M3 12.4C3 7 6.2 3.6 13 3.6" />
    <rect x="1.6" y="11" width="2.8" height="2.8" />
    <rect x="11.6" y="2.2" width="2.8" height="2.8" />
  </Small>
)

export const RectGlyph = (): ReactElement => (
  <Small>
    <rect x="2.6" y="3.8" width="10.8" height="8.4" rx="1.2" />
  </Small>
)

export const EllipseGlyph = (): ReactElement => (
  <Small>
    <ellipse cx="8" cy="8" rx="5.4" ry="4.4" />
  </Small>
)

export const ImageGlyph = (): ReactElement => (
  <Small>
    <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.2" />
    <path d="M2.8 10.8 6 8l2.6 2.2 2-1.6 2.6 2.2" />
  </Small>
)

export const PlusIcon = (): ReactElement => (
  <Glyph>
    <path d="M8 3.4v9.2M3.4 8h9.2" />
  </Glyph>
)

export const TrashIcon = (): ReactElement => (
  <Small>
    <path d="M2.8 4.4h10.4" />
    <path d="M6.4 4.4V3.2h3.2v1.2" />
    <path d="M4.2 4.4l.6 8.2h6.4l.6-8.2" />
  </Small>
)
