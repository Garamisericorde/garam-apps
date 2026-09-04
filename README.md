# garam-apps

Three small Windows desktop apps that share one design system, one set of
libraries and one build chain.

| | |
|---|---|
| **G-Snap** | Screen capture and annotation, in the shape of Lightshot. Press PrintScreen, drag a region, draw on it, copy or save. |
| **G-Recorder** | Always-on instant replay. Keeps the last few minutes in a rolling buffer; one hotkey writes them to an MP4. Plus simple IN/OUT trimming. |
| **G-Note** | Notes: rich text, sticky notes and freehand drawing. |

Windows 10 and 11, x64. Free, and free to do anything with — see
[License](#license).

## Install

Each app has its own installer, and they are **fully independent** — installing
one never requires the others. Grab whichever you want from
[Releases](https://github.com/Garamisericorde/garam-apps/releases).

There is also **Garam Setup**, a ~3.6 MB downloader: run it, tick the apps you
want, and it fetches and installs only those. It verifies every download's
SHA-256 against [`catalog.json`](catalog.json) before running it, so a corrupted
or tampered installer is never executed.

## G-Snap

The one with the most work in it.

- **~185 ms** from keypress to overlay, using a GDI `BitBlt` screen grab through
  a direct user32/gdi32 FFI. Electron's own `desktopCapturer` needs ~350-400 ms
  for the same frame.
- **Pixel-exact crops.** Selections snap to whole device pixels, which matters
  more than it sounds: a fractional offset at fractional DPI scaling costs 25%
  of edge contrast, and that is what makes most screenshot tools look soft.
- **Works over games.** PrintScreen is caught with a low-level keyboard hook,
  which also stops Windows spending ~530 ms on its own PrintScreen handling
  first.
- Pen, highlighter, line, arrow, rectangle, ellipse and text. Shift constrains,
  Alt draws from the centre, and freehand strokes are smoothed so a shaky mouse
  does not produce a shaky line.
- **Nine languages**, English by default.

## Built with

Electron 32 · React 18 · TypeScript · Konva · Vite · Tauri (the setup) ·
koffi (Windows FFI) · FFmpeg (recording)

```
garam-apps/
├── packages/
│   ├── theme/      @garam/theme  — design tokens (the source of colour)
│   ├── ui/         @garam/ui     — shared React components
│   └── core/       @garam/core   — settings, logging, files, IPC plumbing
├── apps/
│   ├── g-snap/
│   ├── g-recorder/
│   └── g-note/
├── installer/
│   └── bootstrapper/  Garam Setup
└── tools/
    ├── icons/      shared icon generator
    └── release/    catalog.json generator
```

The `@garam/*` packages are consumed as uncompiled TypeScript and bundled into
each app, which is what keeps the apps standalone despite sharing code.

## Development

```bash
npm install
```

One `node_modules`, one lockfile, Electron downloaded once.

```bash
npm run dev:snap
```

`dev:recorder` and `dev:note` for the others. To produce an installer:

```bash
npm run package -w g-snap
```

Output lands in `apps/<app>/release/`.

Each app has a `CLAUDE.md` next to it recording why things are the way they
are — the measurements behind the capture path, the DPI traps, the Windows
elevation rules. Read those before changing anything that looks odd; most of it
looks odd for a reason.

## A note on how this was built

This repository was written almost entirely by an AI assistant (Claude), working
from a running conversation of requirements, bug reports and screenshots. The
commit history and the `CLAUDE.md` files reflect that: they record the
measurements and the wrong turns as much as the final shape.

Treat it accordingly. It is tested by use rather than by a test suite, and the
translations have not been reviewed by native speakers.

## License

[MIT](LICENSE). Use it, change it, ship it, sell it — commercially or not, with
or without your changes published. The only condition is that the copyright
notice travels with copies of the source.

It also comes with **no warranty**. That matters here: G-Snap needs
administrator rights to see the PrintScreen key while an elevated app is in
front, and G-Recorder writes video to your disk continuously while its buffer is
on. Both are ordinary things for tools of their kind to do, and both are yours
to run at your own risk.
