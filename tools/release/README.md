# Release delivery

Build the desired apps, then run `npm run catalog`. Artifact names are taken
from each app's version and explicit release configuration; old EXEs and
personal backup ZIPs are never selected by modification time.

Authenticate with `gh auth login --web --scopes workflow`, then run
`powershell -NoProfile -File tools/release/publish.ps1`. Every installer is
hashed again, uploaded to its version release, and only then is `catalog.json`
published to the `catalog` release. G-Presets personal backups stay local.

The latest setup reads the catalog release rather than a raw file on a branch.
EXE installers run silently. ZIP packages are verified, safely extracted, and
their configured PowerShell install entry points run without interactive BAT
pauses. G-DPI remains a service package and G-Presets remains a plugin package.

The `Build Garam Setup` GitHub workflow builds and tests the standalone Tauri
EXE on Windows and uploads it to `setup-v0.2.0`. It runs on the
`codex/setup-release` branch or can be dispatched manually. Users download
`Garam-Setup-0.2.0.exe` directly; there is no setup-for-the-setup.
