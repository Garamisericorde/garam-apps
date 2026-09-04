import { PAD_BUTTONS, TRIGGER_THRESHOLD } from '../../shared/gamepad'
import { lazyBindings } from './ffi'

/**
 * Reading a controller through XInput.
 *
 * The Web Gamepad API cannot do this job: Chromium only reports pads to a
 * FOCUSED document, so the moment the game takes the foreground — which is the
 * only moment this feature is for — the renderer sees nothing at all. XInput
 * reads the driver's state directly and does not care which window has focus.
 *
 * It also does not take the pad away from anything. XInput is a polling API
 * over shared state: the game reads it, we read it, neither notices the other.
 *
 * Xbox pads and anything that presents as one (Steam Input, DS4Windows) work.
 * A DualSense on its own speaks plain HID and is invisible here.
 */

/** Windows 8 onwards ships 1_4; the older names cover machines that do not. */
const DLL_NAMES = ['xinput1_4.dll', 'xinput1_3.dll', 'xinput9_1_0.dll']

/** XInput supports four pads, and there is no way to ask how many are real. */
export const MAX_PADS = 4

const ERROR_SUCCESS = 0

interface XInputState {
  dwPacketNumber: number
  Gamepad: {
    wButtons: number
    bLeftTrigger: number
    bRightTrigger: number
    sThumbLX: number
    sThumbLY: number
    sThumbRX: number
    sThumbRY: number
  }
}

const bindings = lazyBindings((koffi) => {
  koffi.struct('XINPUT_GAMEPAD', {
    wButtons: 'uint16',
    bLeftTrigger: 'uint8',
    bRightTrigger: 'uint8',
    sThumbLX: 'int16',
    sThumbLY: 'int16',
    sThumbRX: 'int16',
    sThumbRY: 'int16',
  })
  koffi.struct('XINPUT_STATE', {
    dwPacketNumber: 'uint32',
    Gamepad: 'XINPUT_GAMEPAD',
  })

  for (const name of DLL_NAMES) {
    try {
      const lib = koffi.load(name)
      return {
        name,
        getState: lib.func(
          'uint32 __stdcall XInputGetState(uint32 dwUserIndex, _Out_ XINPUT_STATE *pState)',
        ),
      }
    } catch {
      // Try the next name. Only the last failure is worth reporting.
    }
  }

  throw new Error(`None of ${DLL_NAMES.join(', ')} could be loaded`)
})

/** Whether XInput is usable at all on this machine */
export function xinputAvailable(): boolean {
  return bindings() !== null
}

/**
 * The buttons held on one pad, or null when nothing is plugged into that slot.
 *
 * The triggers are folded in as two more buttons, so a caller matching a
 * binding has one number to compare and does not have to know that half of it
 * came from an analogue axis.
 */
export function readPad(index: number): number | null {
  const api = bindings()
  if (!api) return null

  const state = {} as XInputState
  if (api.getState(index, state) !== ERROR_SUCCESS) return null

  const pad = state.Gamepad
  let mask = pad.wButtons
  if (pad.bLeftTrigger >= TRIGGER_THRESHOLD) mask |= PAD_BUTTONS.LT
  if (pad.bRightTrigger >= TRIGGER_THRESHOLD) mask |= PAD_BUTTONS.RT
  return mask
}
