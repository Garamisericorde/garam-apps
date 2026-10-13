# G-DPI

Windows x64 service manager around the unmodified GoodbyeDPI 0.2.3rc3 engine.
Upstream binaries and licenses are bundled; `resources/engine/manifest.json`
records their SHA-256 hashes and download origin. Installation verifies hashes.

## Usage

Extract the current G-DPI ZIP, then right-click service_install.bat and choose Run as administrator. The installer copies the engine and service scripts to C:\Program Files\G-DPI and installs the automatic G-DPI service using the Superonline profile. The extracted package may be deleted after successful installation. No setup EXE or Electron interface is needed.

If another ISP needs an alternative, run service/service_install_cloudflare.bat as administrator. This changes the service profile; it does not change Windows adapter DNS settings. Compatibility must be tested on the target connection.

Reinstallation stops only the engine in this installation's directory and skips identical binaries, including loaded drivers. If a changed file remains locked, restart Windows and rerun the installer. Existing unrelated DPI tools and shared drivers are not removed.

To remove the service, run service_remove.bat as administrator, either from the package or C:\Program Files\G-DPI\service. Engine files are retained for reinstallation; shared WinDivert drivers and system DNS settings are unchanged.

For another profile, run resources/service/install.ps1 (source) or service/install.ps1 (package) from elevated PowerShell with -Profile standard or -Profile cloudflare. The standard profile uses the current Windows DNS settings.

Open https://discord.com/app after installation and test login and a voice channel on your Superonline connection. Access is not guaranteed for every ISP deployment. The optional Electron interface remains available with npm run dev:dpi from an elevated terminal.

## Build

Run npm run package:dpi to create the versioned ZIP under release. This distribution contains BAT installers, PowerShell helpers, the engine and license notices. Garam Setup downloads this ZIP and runs service/install.ps1 automatically.

## Sources

- Engine: https://github.com/ValdikSS/GoodbyeDPI
- Superonline profile (-5 and Yandex DNS port 1253):
  https://github.com/cagritaskn/GoodbyeDPI-Turkey/blob/master/windows/service_install_dnsredir_turkey_alternative4_superonline.cmd
- Third-party license notices: `resources/engine/licenses`.
