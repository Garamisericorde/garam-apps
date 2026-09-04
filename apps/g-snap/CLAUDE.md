# g-snap — app rules

Lightshot-style screen capture. Every choice below was made against a
measurement; the numbers are from a 2560x1440 screen at 110% scaling
(`scaleFactor = 1.1041666`, DIP bounds 2319x1305). Re-measure before changing
any of it.

## Capture engine

`ScreenCapture.captureAllDisplays` tries GDI first and falls back.

| Engine | Time | Pixels differing from a lossless reference |
|---|---|---|
| **GDI BitBlt** (`GdiCapture.ts`, via koffi) | **~58 ms** | 0.6%, worst channel error 9 |
| `desktopCapturer` | ~350-400 ms | reference |
| `getUserMedia` (WebRTC) | ~170 ms | **12.8%, worst error 189** |

- `desktopCapturer`'s cost is fixed session setup, NOT pixels: asking for a 1x1
  thumbnail still takes 322 ms. There is nothing to tune.
- `getUserMedia` is fast but runs the frame through WebRTC, which
  chroma-subsamples it. Rejected: unusable for a screenshot tool.
- GDI is a straight memory blit — no scaling, no colour conversion, so it
  cannot soften the image.

**GDI's limit:** it reads the DWM-composited desktop. A game using *independent
flip* is handed straight to the display and its rectangle comes back solid
black, while the rest of the screen looks fine. A whole-frame blank check misses
that, so `regionIsUniform` samples the foreground window's own rect and falls
back only when it really did not capture. Do not go back to skipping GDI merely
because a full-screen app is in front — that cost 400 ms on every capture for no
reason, including for maximised ordinary windows.

## Blur — the bug that took the longest to find

The capture was already native resolution. The damage happened at crop time:
the selection was rounded in CSS units, and `461 * 1.1041666 = 508.9` device
pixels is a **sub-pixel offset**, which blends every pixel with its neighbour.

Measured on a 1px stripe pattern (source contrast 255):

| Path | Contrast |
|---|---|
| Fractional offset (old) | 192 |
| Fractional offset at exactly 1:1 scale | 192 — the offset alone does it |
| Integer device-pixel crop | **255** |

Against Electron's own `nativeImage.crop()`: the new path differs on **0 of
65436 pixels**; the old one corrupted 71.75%.

Rules:
- Snap the crop to whole device pixels (`Math.round(sel.x * DPR)`), then copy
  with a plain `drawImage`. Never hand Konva a fractional crop rectangle.
- Size the Konva stage from the DEVICE size (`deviceWidth / DPR`), not from
  `display.bounds`. A stage 2319 CSS px wide gets a 2560-pixel backing store
  painted into a 2560.56-device-pixel box, and the browser rescales by 0.02% —
  which costs 25% of edge contrast.
- Round capture sizes to the nearest EVEN integer. `bounds * scaleFactor` misses
  the true pixel count by one at fractional DPI, and every real display mode is
  even in both dimensions.

## Hotkeys

PrintScreen is registered **twice**, deliberately (`HotkeyManager.ts`):

1. A low-level keyboard hook (`KeyboardHook.ts`). With `globalShortcut` alone,
   Windows still runs its own PrintScreen handling and blocks this process for
   **532 ms** before any of our code runs — measured as a bare
   `await Promise.resolve()` taking 532 ms from the hotkey but 0 ms from the
   tray. The hook swallows the key so that never starts.
2. `globalShortcut` as a fallback, for contexts where the hook is blocked.

They cannot double-fire: when the hook runs it swallows the key, so the OS
hotkey never sees it.

The hook callback must return immediately — Windows drops a hook that exceeds
`LowLevelHooksTimeout` (300 ms). It only reads `vkCode` and defers with
`setImmediate`.

## Administrator rights are required

`electron-builder.yml` sets `requestedExecutionLevel: requireAdministrator`.

Windows' UIPI rule stops a lower-integrity process from seeing keyboard input
while an elevated app is in front. Games with anti-cheat run elevated, so
without this **neither** the hook nor `globalShortcut` fires there — the capture
silently does not happen, with nothing in the log. Verified: identical build,
identical game, works elevated and does nothing otherwise.

Consequence: `app.setLoginItemSettings` cannot auto-start an elevated app.
Launch-at-login goes through a scheduled task with `/RL HIGHEST`
(`settings/startup.ts`).

Second consequence, and it bit: **the installer must be elevated too**
(`perMachine: true`). A per-user uninstaller runs unelevated, so it could not
terminate the elevated app or delete its files — it removed its own registry
entry, gave up, and left an app that was gone from Control Panel but still
running and still starting at every logon.

Third: the startup task is created by the APP at runtime, so NSIS has no record
of it and would never remove it. `build/installer.nsh` kills the process in
`customUnInit` (before file removal) and runs `schtasks /delete` in
`customUnInstall`. Anything else the app registers outside the installer's
knowledge has to be undone there too.

Fourth: `runAfterFinish` is OFF and `customInstall` runs the app instead.
electron-builder's finish-page launch deliberately drops privileges, and for a
requireAdministrator app that means a UAC prompt the instant setup ends. The
installer is already elevated, so a plain `Exec` hands the app that token — no
prompt — and that first run is what registers the logon task. From then on the
task's `/RL HIGHEST` keeps every start elevated and silent.

So the chain is: elevated installer -> elevated first run -> task registered ->
elevated silent start at every logon. Break any link and the app either prompts
or does not start.

`--hidden` distinguishes the two: the logon task passes it and gets a silent
tray start; a shortcut, or the installer's launch, does not and opens Settings.
A tray app that shows nothing at all when you run it looks like it failed.

## Overlay window

- Created ONCE at startup and never destroyed. Building a full-screen window and
  loading the renderer costs a few hundred ms and must not sit on the hotkey path.
- It is **never hidden**. Chromium produces no frames for a hidden window, so the
  first reveal showed an unpainted white surface. Idle state is `opacity 0` plus
  `setIgnoreMouseEvents(true)`, which keeps a live painted surface and makes
  revealing a one-property change.
- DWM open/close animation is turned off via `DWMWA_TRANSITIONS_FORCEDISABLED`,
  otherwise the overlay fades in instead of snapping open.
- A tray app is not the foreground process, so `win.focus()` alone is refused by
  Windows and the overlay opens without keyboard focus — Esc does nothing while
  right-click still works. `forceForeground` uses `AttachThreadInput`.
- **Always give the foreground back on close** (`restoreForeground`). Otherwise
  the previous app keeps drawing but receives no keyboard input until clicked —
  in a game that means WASD stops working.

## The native layer must never be able to throw at import

`GdiCapture`, `WindowFocus` and `KeyboardHook` all used to call
`koffi.load()` at module scope. That runs while the main process is still
evaluating its import graph — before the logger, before any window, before
`process.on('uncaughtException')` is registered at the bottom of
`main/index.ts`. A koffi that could not be required therefore produced
Electron's raw "A JavaScript error occurred in the main process" dialog, an
app that never started, and NOTHING in the log.

It happened for real: an install left `koffi.node` marked unpacked in the asar
header but absent from `app.asar.unpacked` (the app was running elevated, so
the per-user installer could not replace its files).

Every native path here is a fast path with a fallback — GDI falls back to
`desktopCapturer`, the hook falls back to `globalShortcut`, focus control
falls back to Electron's `focus()`. So:

- Reach koffi ONLY through `main/native/ffi.ts`. It uses a runtime `require`
  (a static import gets hoisted to the top of the bundle, which is the eager
  load being avoided) and returns null instead of throwing.
- Declare bindings with `lazyBindings()`; build them on first use.
- Each entry point degrades to whatever its contract already documents.
- `bootstrap()` logs one warning when the FFI is missing, so a slow app is
  explained rather than mysterious.

Without the FFI the app is slower, not dead. Keep it that way.

## Look

The accent is a blue-to-purple ramp (`@garam/theme/accent-violet.css`), which
is what separates g-snap from its crimson siblings. It appears in three places
and they must not drift: the icon (`scripts/generate-icons.mjs`), the settings
hairline (`styles/settings.css`), and the selection outline.

Konva can gradient-FILL a shape but not gradient-STROKE one, so the selection
outline is a `Shape` with a hand-written `sceneFunc` that sets `strokeStyle` to
a `createLinearGradient` running corner to corner. The resize handles are 8px —
too small for a ramp — so each samples the outline's colour by projecting its
anchor onto the gradient's diagonal. Averaging x and y instead puts every corner
at the middle of the ramp as soon as the selection is not square.

The window itself follows a layered dark scale rather than a single mid navy:
a near-black floor (`--bg`) with panels stepped up above it, each step small
enough to read as depth instead of as a colour change, and the violet held to a
single-digit tint — a saturated surface fights an already saturated accent.
Panels carry a 2px accent hairline along the top edge, fading out to the right;
it costs nothing and gives a flat card a light source.

One trap worth knowing: `--accent-gradient` is tuned for filling a button, so
across a six-character wordmark it barely leaves the blue end. Anything text
sized paints itself with an explicit ramp spanning its own width instead.

The overlay carries NO standing instructions. A hint that follows the cursor
covers the very area being selected; the shortcut list lives in Settings. The
only thing the overlay says is live state (Ctrl held -> will copy on release).

## Drawing tools

**Modifiers** (`strokes.ts`). Shift constrains — square, circle, or a segment
snapped to 45° with the dragged LENGTH preserved. Alt makes the start point the
centre, which is the gesture for ringing something you are pointing at: cursor
on the target, Alt, pull outwards. Under Shift the LARGER of the two travels
wins; taking the smaller one makes the corner lag behind the pointer.

Both are re-applied on keydown/keyup, not only on mouse move, because both are
routinely pressed after the drag has started and without the mouse moving —
otherwise the key looks dead. Alt's keydown is `preventDefault`ed: on Windows a
bare Alt opens the window menu and takes focus, abandoning the drag.

**Sizes are per tool.** A shared slider meant setting the pen's width also set
the highlighter's. `sizes: Record<SizedTool, number>` with a range per tool —
the highlighter's is 6–60, because a 3px highlighter is not a highlighter. The
control opens beside the button of the tool it sizes, so it is obvious whose
size is changing. The highlighter's stroke is no longer the pen's width times a
constant; its slider sets the real width.

**Pen smoothing.** A mouse reports far more often than a hand can meaningfully
move, so a slow stroke collects dozens of samples inside two pixels — pure
tremor, and Konva's `tension` spline is obliged to pass through every one of
them. Two stages fix it:

1. A 2.4px dead zone plus a low-pass filter on input (`appendPoint`).
2. Ramer-Douglas-Peucker at 0.9px when the stroke is committed (`smoothStroke`),
   then `tension={0.4}` draws the curve.

Measured on a synthetic hand-drawn stroke of 600 samples with 0.8px tremor:

| Stroke | Raw | After dead zone | Kept |
|---|---|---|---|
| Near-straight diagonal | 600 | 163 | **7** |
| Circle, radius 80 | 600 | 288 | **34** |

Shape-aware, not uniformly aggressive: the line collapses because it IS a line,
while the circle keeps enough points to stay a circle — worst radius error on
the survivors is 0.70px, which is the tremor itself.

RDP is iterative on purpose; the recursive form is a stack overflow waiting for
a long stroke.

## Translation

Nine languages, English as the source. `src/shared/i18n/en.ts` is the
dictionary everything else is derived from: `Messages` is
`Record<keyof typeof en, string>`, so a locale that misses a key does not
compile. Add the key to `en.ts` first, then to the eight others.

It lives under `shared/` because BOTH processes render strings — the tray menu
and the file dialogs are built in the main process, the toolbars and settings in
the renderer.

The locale is module-level mutable state, not a React context. The main process
has no React, and threading a context through both processes to translate eighty
strings would cost more than it explains. The rule that makes it safe: always
call `setLocale()` BEFORE the state update that triggers the re-render —
`SettingsApp` does it in `patch()`, the overlay does it on init.

The overlay never reads the settings itself (it is on the hotkey path, and a
round trip there is a round trip too many), so the language rides along inside
`OverlayInit` with the frame.

Two things deliberately stay untranslated: key names in the shortcut list, which
are what is printed on the keyboard, and the language labels themselves, which
are endonyms — a picker that says "German" to someone who only reads German is a
picker they cannot use.

Default is English, NOT the system locale. A wrong guess is worse than a
predictable default, and the picker is the first row in Settings.

## Konva

- `getPointerPosition()` is only updated on a pointer event. Right after the
  window opens it is still **(0,0)**, so the first click's position must come
  from the native event.
- Konva diffs the `image` prop by **identity**. Reusing one canvas across
  captures makes it decide nothing changed and keep showing the PREVIOUS frame —
  that shipped once as a stale screenshot. Always allocate a fresh canvas.
- Hide the dim and selection-chrome layers before exporting.

## Transport

The raw frame is ~14 MB per display and goes over IPC as BGRA
(`nativeImage.toBitmap()`, 4 ms) rather than a PNG data URL (137 ms to encode,
more to decode). The renderer swaps B and R with a 32-bit view and hands it to
`createImageBitmap`; the whole renderer-side path measures ~30 ms.

Do not park those buffers in React state — build the composite straight from the
IPC handler so the pixels become garbage immediately.

## Current latency

| Path | Total |
|---|---|
| Desktop, GDI | ~185 ms |
| Full-screen game, desktopCapturer fallback | ~600 ms |

### Warm-up

The first capture of a session measured **302 ms against 116 ms** for every one
after it. Where that gap is NOT:

| One-off cost | Measured |
|---|---|
| `require('koffi')` | 94.7 ms — already paid at startup |
| Building every koffi binding | 0.4 ms |
| First BitBlt over a warm one | ~8 ms |

So it is almost entirely renderer-side: the BGRA swap, `createImageBitmap`,
Konva building its stage, the first paint. Loading the page is not the same as
having rendered with it.

`OverlayWindow.warmRenderer()` therefore pushes one BLANK frame through the
whole path at startup, at opacity 0, and the renderer drops it after the paint
instead of calling `overlay:ready`. Blank rather than a real screenshot on
purpose — identical work, without the app photographing the screen unasked.

### The window is reused, so its state is stale

The overlay window is never destroyed, so React state survives a close. The
cursor readout came back at the position it held when the last capture ended
and only corrected itself on the first mouse move — nothing in a page can know
where the pointer is until an event arrives. `OverlayInit` therefore carries
`cursor`, read from `screen.getCursorScreenPoint()` in the main process.
Anything else held in component state has to be reset on init for the same
reason.

## Not solved

True *exclusive* fullscreen. Both capture and drawing over it are outside what
Electron and FFI reach cleanly; the answer would be DXGI Desktop Duplication in
a real C++ addon, not COM vtable calls through koffi.
