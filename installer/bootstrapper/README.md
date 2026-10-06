# Garam Setup 0.2.0

A single downloadable EXE with a selectable list of all six Garam applications.
It downloads selected packages from GitHub Releases, verifies SHA-256 hashes,
and runs the appropriate installer. EXEs run silently; ZIP service and plugin
packages use their PowerShell entry points without interactive BAT pauses.

The runtime catalog is published at:
https://github.com/Garamisericorde/garam-apps/releases/download/catalog/catalog.json

G-Snap, G-Recorder, G-Note and G-Vector use EXE installers. G-DPI installs its
automatic service. G-Presets installs ProfilePresets into an existing standard
Vencord installation; close Discord first. Public packages contain no personal
preset backups. The public plugin installer keeps existing presets.

The setup requests administrator privileges once. WebView2 is required.
Failed packages report errors; completed apps are deselected before retry.

## Build and publish

The Windows workflow .github/workflows/build-setup.yml installs Rust, runs
installer validation tests and builds the standalone executable. It publishes
Garam-Setup-0.2.0.exe on setup-v0.2.0. Download that EXE directly.

For local builds install Rust and Visual C++ build tools, then run npm ci and
npm run build in this directory. npm run ui:build checks the UI without Rust.
GARAM_CATALOG_URL overrides the runtime catalog URL at build time.

Run npm run catalog at the repository root to create schema 2 using the exact
versioned artifacts in tools/release/apps.json. tools/release/publish.ps1 uploads
all app installers before publishing the catalog. Personal preset ZIPs stay local.

The renderer passes application IDs; Rust selects trusted cached catalog entries.
Rust validates release URLs, filenames, checksums and archive entry points. ZIP
extraction rejects escaping paths and symlinks and limits file count and size.

Version 0.1.x supports only the earlier EXE-only schema and raw-branch catalog.
Use version 0.2.0 for the complete application list.
