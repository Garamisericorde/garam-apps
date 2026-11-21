# Garam Setup 0.3.1

A single downloadable EXE with a selectable list of all six Garam Windows applications.
It downloads selected packages from GitHub Releases, verifies SHA-256 hashes,
and runs the appropriate installer. EXEs run silently; ZIP service and plugin
packages use their PowerShell entry points without interactive BAT pauses.

## Share a setup with panel enrollment

In Garam Device Management, click **New enrollment code**. Make a copy of the
setup EXE and name it `Garam-Setup-0.3.1.invite-CODE.exe`, replacing `CODE` with
the generated code. Share the copy privately and keep its filename. The code
expires after 30 minutes. The recipient selects their apps and can opt in to
device management in Setup. Successfully installed apps register on their next
contact with the panel. The panel PC and its HTTPS tunnel must be running.

The runtime catalog is published at:
https://github.com/Garamisericorde/garam-apps/releases/download/catalog/catalog.json

G-Snap, G-Recorder, G-Note and G-Vector use EXE installers. G-DPI installs its
automatic service. G-Presets installs ProfilePresets into an existing standard
Vencord installation; close Discord first. Public packages contain no personal
preset backups. The public plugin installer keeps existing presets.

The setup requests administrator privileges once. WebView2 is required.
Each selected package is attempted even if an earlier package fails. The final
screen lists installed apps and individual failures; completed apps are
deselected before retry. Existing GoodbyeDPI services block only G-DPI, with
instructions to remove the old service using its own removal script or leave
G-DPI unchecked. Other selected apps, including G-Snap, still install.

## Build and publish

The Windows workflow `.github/workflows/build-setup.yml` installs Rust, runs
installer validation tests and publishes the standalone executable. Download
[Garam-Setup-0.3.1.exe](https://github.com/Garamisericorde/garam-apps/releases/download/setup-v0.3.1/Garam-Setup-0.3.1.exe).

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

## Network-safe installation flow

All selected packages are downloaded and verified before any installer runs.
If a download or checksum fails, no new applications or network profiles are
installed in that batch. Other application installers run before G-DPI. If any
of them fails, a new G-DPI install is skipped.

The setup inspects the G-DPI service without changing it. Any existing G-DPI
service, running or stopped, is excluded from installation and its profile is
preserved. To change an existing profile, use the provider BAT in the G-DPI
package explicitly. Fresh G-DPI installs require Superonline or Vodafone in
the setup picker; the default never silently chooses Superonline. Catalog
arguments cannot override this explicit choice. G-DPI packages older than
0.1.5 are rejected for new installations. If a fresh G-DPI script fails, the
setup invokes that package's service removal script to restore its DNS policy.

Version 0.2.0 should no longer be used on a working Vodafone configuration.

G-DPI packages starting at app version 0.2.0 install their own signed automatic
update and provider-support checks. The picker explains this behavior before
installation. A discontinued provider is stopped with a user notice and DNS
restoration. Existing services are still preserved by Setup; users upgrading
an older G-DPI package must run the new provider BAT explicitly.
