# Garam Setup

A small downloader-style installer. It does not embed the apps; it reads
`catalog.json`, downloads whatever the user selected, verifies it and installs
it silently.

**Status: the UI half is built and verified against the real catalog; the Rust
half has never been compiled.** Rust is installed, but on Windows rustup alone
cannot link — see Prerequisites.

## Why this design

| | One big setup | This approach |
|---|---|---|
| Size | ~250 MB (all three apps embedded) | ~3-5 MB |
| Shipping a new version | Republish the setup | Just update `catalog.json` |
| User wants one app | Downloads everything | Downloads only what they picked |

The UI is HTML/CSS, so it uses the same colors as `@garam/theme` — the setup
looks like the apps it installs.

## Prerequisites

Two things, and the second is the one everybody misses:

```bash
winget install Rustlang.Rustup
```

```bash
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

rustup installs a compiler but NOT a linker. The default toolchain is
`x86_64-pc-windows-msvc`, which needs `link.exe` from the Visual C++ build
tools; without it even an empty `fn main()` fails with
"error: linker `link.exe` not found".

The WebView2 runtime ships with Windows 11 and is usually present on Windows 10.

## What it runs as

The setup carries a manifest requesting **administrator**
(`src-tauri/app.manifest`). That is not decoration: g-snap installs
per-machine, and a SILENT NSIS installer cannot raise its own privileges — it
just fails. Elevating the setup means every installer it launches inherits the
token, and one UAC prompt covers the whole session.

Supplying a manifest replaces the one tauri-build generates, so that file also
has to restate the DPI and supportedOS blocks.

## Run

```bash
npm install
```

```bash
npm run dev
```

## Build

Pass the catalog URL at build time:

```bash
GARAM_CATALOG_URL=https://raw.githubusercontent.com/Garamisericorde/garam-apps/main/catalog.json npm run build
```

Without the variable it falls back to that same URL, compiled into
`src/main.rs`.

**Ship `src-tauri/target/release/Garam Setup.exe`** — the single portable
executable. The NSIS bundle beside it is an installer FOR the setup, which is
not what anyone wants; it is a byproduct of the bundle config.

## Theme

`src/styles.css` imports `@garam/theme` rather than copying its tokens. An
earlier version copied them with a note asking whoever changed one to change
the other, and they drifted within the week — the apps moved to a blue-purple
accent and rounder corners while the setup stayed crimson and square. Vite
inlines the import at build time, so the standalone build is still one file.

## Security

- Every download's **SHA-256 is compared against the catalog**. On a mismatch the
  file is deleted and the install stops — a corrupt or tampered installer is
  never executed.
- HTTPS via `rustls`; no dependency on system OpenSSL.
- The Tauri allowlist is off except for `shell.open`.

## catalog.json format

```json
{
  "schemaVersion": 1,
  "publishedAt": "2026-08-25T14:00:00.000Z",
  "apps": [
    {
      "id": "g-snap",
      "name": "G-Snap",
      "description": "Screen capture, annotation and quick sharing",
      "version": "0.1.0",
      "sizeBytes": 74000000,
      "default": true,
      "requires": [],
      "installer": {
        "fileName": "G-Snap-0.1.0-setup.exe",
        "url": "https://github.com/USERNAME/garam-apps/releases/download/g-snap-v0.1.0/G-Snap-0.1.0-setup.exe",
        "sha256": "...",
        "silentArgs": ["/S"]
      }
    }
  ]
}
```

Generate it from the repo root with `npm run catalog`.

## NSIS note

The installer electron-builder produces runs silently with `/S`. To set the
target folder, `/D=<path>` must be **unquoted and the last argument** — a
notoriously brittle NSIS rule.
