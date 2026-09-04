# garam-apps — monorepo rules

Three Electron apps sitting on a shared design system and shared infrastructure.
For app-specific rules see `apps/<app>/CLAUDE.md` as well.

## Language

All code, comments, commit messages and docs are in **English**, with no
exceptions.

User-facing strings are written in English too — English is the SOURCE language.
The single exception is a translation file under `i18n/locales/`, which exists
to hold other languages and nothing else. Translations never leak outward: no
identifier, comment, log line or commit message is in anything but English.

## Invariants

- **Color lives in one place:** `packages/theme/src/tokens.css`, plus the
  accent override sheets beside it (`accent-violet.css`, which g-snap imports
  after `all.css`). An app picks which sheet it loads; it never writes hex.
  Always `var(--...)` in app source.
  The JS mirror for Konva/canvas is `packages/theme/src/index.ts` — keep both in step.
- **The accent is a two-stop ramp.** Anything with an area to fill uses
  `var(--accent-gradient)`; anything needing one flat colour uses `var(--accent)`,
  which must stay a point on that ramp. A gradient fill cannot take a flat hover
  colour — change `filter: brightness()` instead, or the fill visibly collapses.
- **Shared components go in `@garam/ui`.** If a button/field/panel is needed by
  two apps, it belongs in the package, not in the app.
- **The `@garam/*` packages are never compiled.** They are consumed as
  TypeScript source with no `dist` output, so every app's electron-vite config
  MUST exclude them from `externalizeDepsPlugin`.
- **The electron-vite config file must be named `electron.vite.config.ts`**
  (dot, not dash) or it is silently ignored.
- **`@garam/theme`'s index must not touch DOM APIs.** The main process imports
  it; DOM-dependent helpers live under `@garam/theme/dom`.

## Security / IPC

- `contextIsolation: true`, `nodeIntegration: false` — no exceptions.
- Every privileged operation the renderer reaches goes through `window.api`.
- Channel names never come from the renderer; the preload binds fixed channels.
- All `ipcMain.handle` calls live in one file (`src/main/ipc/`).

## DPI — the biggest source of bugs in this repo

Fractional scaling is common on Windows (e.g. 110% -> `scaleFactor = 1.1041666`).
`bounds * scaleFactor` IS NOT A WHOLE NUMBER and drifts from the real pixel count:

```
2319 DIP x 1.1041666 = 2560.56  ->  rounds to 2561, but the truth is 2560
```

Even a one-pixel miss makes the image resample at a fractional ratio and blur
visibly (measured: sharpness 4.03 -> 4.90).

Rules:
- Round capture sizes to the **nearest even integer** (`roundToEven`). Both
  dimensions of a real display mode are always even.
- Derive scale from the pixels actually captured, NOT from the OS `scaleFactor`:
  `nativeSize.width / bounds.width`. The magnifier, the export and every crop
  use that value.
- Log the requested vs. returned size after a capture; WARN when they diverge.

## Native Windows APIs

g-snap calls user32/gdi32/dwmapi directly through `koffi` (a prebuilt FFI, no
compiler needed). That is how it gets a ~58 ms screen capture, swallows the
PrintScreen key, and controls window focus and animations. **Pin koffi to ^3.x**:
the 2.x API differs enough that the same code silently fails and falls back.

Details and the measurements behind each choice: `apps/g-snap/CLAUDE.md`.

## Konva notes

- `getPointerPosition()` is only updated on a pointer event. If the window has
  just opened and nothing has moved inside it, that value is still **(0,0)**.
  Compute the first click's position from the native event
  (`clientX/clientY` minus the container rect).
- Hide the dim and selection-chrome layers before exporting, then show them again.
- Konva diffs the `image` prop by identity. Reusing a canvas across frames makes
  it skip the redraw and keep showing the previous one.

## Windows filesystem

- **Strip the BOM when reading JSON.** PowerShell's `-Encoding utf8` and Notepad
  write UTF-8 with a BOM, and `JSON.parse` throws on that character — settings
  then silently fall back to defaults. `readJson` in `@garam/core` handles it.
- Settings are written atomically (temp file + `rename`); no half-written file.
- File names strip reserved names (CON, PRN, COM1...) and control characters —
  see `sanitizeFileName`.

## Source hygiene

- **Never put invisible characters in source** (BOM, U+FEFF, Cyrillic lookalikes).
  If a regex needs a BOM, build it with `String.fromCharCode(0xfeff)`.
- TypeScript strict; `noUnusedLocals` is on.
- Keep files focused; no giant single-file components.

## Build and verify

```bash
npm run typecheck -w g-snap
```

```bash
npm run build -w g-snap
```

Build output goes to `apps/<app>/out/`; the monorepo root must stay clean.

## Packaging

Three things bite on Windows, all of them invisible in dev mode:

- **Pin the Electron version exactly** in each app's devDependencies. npm
  workspaces hoist `electron` to the root, and electron-builder cannot resolve a
  range like `^32.0.0` from there — it fails with "Cannot compute electron
  version from installed node modules".
- **A native module must never be required at import time.** The main process
  evaluates its import graph before any error handler exists, so a throw there
  is an unlogged crash dialog rather than a caught error. Load it lazily behind
  a helper that returns null (g-snap: `main/native/ffi.ts`).
- **Native modules must be listed in `asarUnpack`.** `koffi` ships its binary as
  `@koromix/koffi-win32-x64/**/koffi.node`, and a `.node` file cannot be loaded
  from inside `app.asar`. It packs happily and then the app dies on startup.
  g-snap unpacks `**/*.node` and `**/@koromix/**`.
- **Whatever the app registers with the OS at runtime, the uninstaller must
  undo.** g-snap's launch-at-startup is a scheduled task the app creates
  itself; NSIS knows nothing about it, so without `nsis.include` pointing at a
  script that deletes it, uninstalling leaves it relaunching a deleted app at
  every logon. An app that requires elevation also needs `perMachine: true`,
  or the unelevated uninstaller cannot even stop it.
- **electron-builder needs symlink privileges** to extract its winCodeSign
  cache, which contains macOS symlinks it does not even need on Windows. Without
  them the build fails with "Cannot create symbolic link". Run the packaging
  from an elevated shell, or turn on Windows Developer Mode. Pre-extracting the
  cache does not help — it downloads to a fresh random directory each run.

All three apps write to `apps/<app>/release/`, which is what
`tools/release/build-catalog.mjs` scans.

## Icons

`tools/icons/generate.mjs` is a dependency-free PNG/ICO generator; all three apps
share one visual language (rounded square + accent color + white glyph).
Icons are not hand-edited — regenerate with `npm run icons -w <app>`.
