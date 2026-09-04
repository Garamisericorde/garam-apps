import { describe, expect, it } from 'vitest'
import {
  buttonsOf,
  formatBinding,
  isHeld,
  isSafeBinding,
  PAD_BUTTONS,
  parseBinding,
} from '../app/shared/gamepad'

const mask = (...names: (keyof typeof PAD_BUTTONS)[]): number =>
  names.reduce((total, name) => total | PAD_BUTTONS[name], 0)

describe('formatBinding', () => {
  it('names the buttons in a mask', () => {
    expect(formatBinding(mask('A', 'LB'))).toBe('LB+A')
  })

  it('orders shoulders before face buttons, however they were pressed', () => {
    expect(formatBinding(mask('Y', 'RB', 'LB'))).toBe('LB+RB+Y')
    expect(formatBinding(mask('LB', 'Y', 'RB'))).toBe('LB+RB+Y')
  })

  it('reads the triggers as buttons', () => {
    expect(formatBinding(mask('LT', 'RT'))).toBe('LT+RT')
  })

  it('is empty for a pad at rest', () => {
    expect(formatBinding(0)).toBe('')
  })
})

describe('parseBinding', () => {
  it('round-trips what formatBinding writes', () => {
    const original = mask('LB', 'RB', 'A')
    expect(parseBinding(formatBinding(original))).toBe(original)
  })

  it('treats null and empty as unbound', () => {
    expect(parseBinding(null)).toBeNull()
    expect(parseBinding('')).toBeNull()
  })

  it('rejects a name that is not a button', () => {
    // The settings file is hand-editable, and a typo must not become a
    // binding that never fires for reasons nobody can see.
    expect(parseBinding('LB+Circle')).toBeNull()
  })

  it('tolerates spaces around the names', () => {
    expect(parseBinding(' LB + A ')).toBe(mask('LB', 'A'))
  })
})

describe('isHeld', () => {
  it('fires when every button in the binding is down', () => {
    expect(isHeld(mask('LB', 'RB', 'A'), mask('LB', 'RB', 'A'))).toBe(true)
  })

  it('fires with other buttons held too', () => {
    // A game holds half the pad at any moment; an exact match would mean the
    // shortcut worked at the menu and not in a fight.
    expect(isHeld(mask('LB', 'RB', 'A', 'Left', 'LT'), mask('LB', 'RB', 'A'))).toBe(true)
  })

  it('does not fire on part of the binding', () => {
    expect(isHeld(mask('LB', 'A'), mask('LB', 'RB', 'A'))).toBe(false)
  })

  it('never fires on an empty binding', () => {
    expect(isHeld(mask('A'), 0)).toBe(false)
    expect(isHeld(0, 0)).toBe(false)
  })
})

describe('isSafeBinding', () => {
  it('refuses a single button', () => {
    // Every button does something in every game.
    expect(isSafeBinding(mask('A'))).toBe(false)
    expect(isSafeBinding(mask('LB'))).toBe(false)
  })

  it('refuses two face buttons', () => {
    expect(isSafeBinding(mask('A', 'B'))).toBe(false)
  })

  it('accepts two when a shoulder or trigger is one of them', () => {
    expect(isSafeBinding(mask('LB', 'A'))).toBe(true)
    expect(isSafeBinding(mask('LT', 'Y'))).toBe(true)
    expect(isSafeBinding(mask('RS', 'X'))).toBe(true)
  })

  it('accepts any three', () => {
    expect(isSafeBinding(mask('A', 'B', 'X'))).toBe(true)
  })

  it('refuses nothing at all', () => {
    expect(isSafeBinding(0)).toBe(false)
  })
})

describe('buttonsOf', () => {
  it('lists nothing for an idle pad', () => {
    expect(buttonsOf(0)).toEqual([])
  })

  it('lists every button a full mask holds', () => {
    expect(buttonsOf(mask('Up', 'Menu', 'View', 'LS'))).toEqual(['LS', 'View', 'Menu', 'Up'])
  })
})
