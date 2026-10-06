# G-Presets

Profile Presets for an existing Windows Discord + Vencord installation.
The plugin source is in `plugin/`. A complete Vencord source snapshot is in
`vendor/vencord`, including the original userplugin and GPL license.
`resources/vencord` contains the existing compiled custom build imported from
DiscordProfilePresets, version 1.15.10, commit 3374b8a9d8f6b051c64204917360293aad7f5d75.
The installer verifies its hashes. It replaces the compiled Vencord bundle;
Vencord does not support adding a standalone plugin to the official binary build.

## Install

Close Discord completely, including its tray icon. Extract the ZIP and run
`install.bat` as your normal Windows user. No Node, build tools or administrator
privileges are required. The installer detects the existing Stable Discord
Vencord loader and updates `%APPDATA%/Vencord/dist`. It enables ProfilePresets.
For PTB or Canary run `install.bat -Channel discordptb` or `discordcanary`.
Custom Vencord paths and Vesktop are detected as unsupported rather than guessed.
Discord's loader and account profile are not changed by installation.

The personal package also restores `private/backups/Vencord/settings`, themes,
and `private/backups/IndexedDB` to the selected Discord profile. IndexedDB is a
whole database backup, including data beyond ProfilePresets. Existing Vencord
and IndexedDB directories are saved under `%LOCALAPPDATA%/G-Presets/backups`
before replacement; failed operations restore the previous directories.
The backup's old compiled dist is archived but not restored over the plugin build.

Restart Discord and open Settings > Vencord > Plugins > ProfilePresets.
Installation never applies a preset to your Discord account automatically.
Vencord updates can replace custom plugins; run the installer again if needed.

## Development and distribution

`npm run package -w g-presets` builds the public ZIP without personal backups.
`npm run package:personal -w g-presets` includes your local backups; keep this
package private. Personal data is ignored by Git.

For a new plugin build, copy `plugin` into `vendor/vencord/src/userplugins/profilePresets`,
install the pinned pnpm dependencies in that directory, and run its build script.
Copy the desktop dist outputs into `resources/vencord` and regenerate the manifest
hashes before packaging. Imported prebuilt files were retained because the original
checkout's dependency links cannot currently resolve esbuild on this computer.

Custom-plugin workflow: https://docs.vencord.dev/installing/custom-plugins/
