/**
 * Controller bindings.
 *
 * Separate from the keyboard hotkeys because they are a different mechanism,
 * not a different spelling: Windows binds an accelerator to modifiers plus one
 * key, while a pad binding is a set of buttons held at once, and the OS knows
 * nothing about either the set or the pad. Everything here is pure so the
 * matching can be tested without a controller plugged in.
 */

/**
 * XInput's button bits, in the order they are reported.
 *
 * The trigger bits at the top are ours: XInput reports the triggers as an
 * analogue 0-255 each, not as buttons, and a binding wants them either way.
 */
export const PAD_BUTTONS = {
  Up: 0x0001,
  Down: 0x0002,
  Left: 0x0004,
  Right: 0x0008,
  Menu: 0x0010,
  View: 0x0020,
  LS: 0x0040,
  RS: 0x0080,
  LB: 0x0100,
  RB: 0x0200,
  A: 0x1000,
  B: 0x2000,
  X: 0x4000,
  Y: 0x8000,
  LT: 0x010000,
  RT: 0x020000,
} as const

export type PadButton = keyof typeof PAD_BUTTONS

/**
 * How far a trigger must be pulled to count as pressed.
 *
 * XInput's own dead zone is 30 of 255. Anything lower and a trigger resting
 * against its spring reads as held.
 */
export const TRIGGER_THRESHOLD = 30

/** Buttons in a binding, fewest surprises first: shoulders, then face. */
const ORDER: PadButton[] = [
  'LT',
  'LB',
  'RT',
  'RB',
  'LS',
  'RS',
  'View',
  'Menu',
  'Up',
  'Down',
  'Left',
  'Right',
  'A',
  'B',
  'X',
  'Y',
]

/** The buttons a mask holds, in a stable order */
export function buttonsOf(mask: number): PadButton[] {
  return ORDER.filter((name) => (mask & PAD_BUTTONS[name]) !== 0)
}

/** A mask as the string kept in settings, e.g. "LB+RB+A" */
export function formatBinding(mask: number): string {
  return buttonsOf(mask).join('+')
}

/**
 * A settings string back to a mask, or null when it names nothing real.
 *
 * The file is user-editable, so a typo has to read as "not bound" rather than
 * as a binding that never fires for reasons nobody can see.
 */
export function parseBinding(binding: string | null): number | null {
  if (!binding) return null

  let mask = 0
  for (const part of binding.split('+')) {
    const name = part.trim() as PadButton
    if (!(name in PAD_BUTTONS)) return null
    mask |= PAD_BUTTONS[name]
  }
  return mask === 0 ? null : mask
}

/**
 * Whether the binding is held.
 *
 * Every button in the binding has to be down; others may be too. A game holds
 * half the pad at any moment, and requiring an exact match would mean the
 * shortcut worked at the menu and not in a fight.
 */
export function isHeld(mask: number, binding: number): boolean {
  return binding !== 0 && (mask & binding) === binding
}

/**
 * Whether a binding is safe to fire while a game has the pad.
 *
 * A single button is not: every one of them does something in every game, and
 * a replay saved on each jump is worse than no shortcut. Two is only enough
 * when a shoulder or trigger is part of it, which is the combination games
 * reach for last.
 */
export function isSafeBinding(mask: number): boolean {
  const buttons = buttonsOf(mask)
  if (buttons.length >= 3) return true
  if (buttons.length < 2) return false
  return buttons.some((name) => ['LT', 'RT', 'LB', 'RB', 'LS', 'RS'].includes(name))
}
