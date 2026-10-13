# G-DPI

Windows x64 service manager around the unmodified GoodbyeDPI 0.2.3rc3 engine.
Upstream binaries and licenses are bundled; `resources/engine/manifest.json`
records their SHA-256 hashes and download origin. Installation verifies hashes.

## Usage

## AdGuard encrypted DNS mode (Windows 11)

Run dns_adguard_on.bat as administrator first, then completely close and reopen
Discord. It stops G-DPI and sets a Windows DNS policy for Discord domains only,
using AdGuard DoH at 94.140.14.14 with plaintext fallback disabled. Adapter DNS
and unrelated domains are unchanged. The original DoH entry is backed up under
ProgramData/G-DPI. Run dns_restore.bat to remove the policy and restore that entry.
An existing conflicting Discord DNS policy is left unchanged and reported.

If DNS works but Discord access remains blocked, try install_vodafone_adguard_1.bat
through install_vodafone_adguard_4.bat, one at a time. These use encrypted DNS
and different DPI methods limited to the bundled Discord domain list; they
do not redirect DNS to the previously unreachable Cloudflare resolver.
Service removal restores G-DPI's encrypted DNS changes. Restore DNS before
returning to the older Cloudflare/Yandex trial profiles. No VPN is used.

AdGuard DoH DNS responses were verified by the user on the Vodafone connection;
Windows policy deployment and Discord login still require target-machine testing.
The initial VPN exploration is not part of this release.

Run install_superonline.bat for Superonline. Vodafone trial installers are
install_vodafone_1.bat through install_vodafone_6.bat in the package root.
Close Discord completely, run one installer as administrator, then reopen
Discord. If it does not connect, close Discord and try the next number.
These are experimental alternatives, not verified Vodafone configurations.
All installers update the same G-DPI service; removal between attempts is not
required. Windows adapter DNS, IPv6 and proxy settings are never changed.

| Installer | Method | DNS redirection |
|---|---|---|
| Superonline | Automatic TTL, reverse fragmentation | Yandex port 1253 |
| Vodafone 1 | Fake sequence, reverse fragmentation | Cloudflare |
| Vodafone 2 | Fake checksum, reverse fragmentation | Cloudflare |
| Vodafone 3 | Fake sequence/checksum, QUIC blocking | Cloudflare |
| Vodafone 4 | Fake sequence, reverse fragmentation | Yandex port 1253 |
| Vodafone 5 | Legacy fragmentation | Cloudflare |
| Vodafone 6 | Native fragmentation at SNI, no fake packets | Cloudflare |

Run diagnose.bat if the Discord updater still fails. It prints a read-only
report and saves it under the Windows temporary directory. Check the report
before sharing it: it includes local paths, adapter names and DNS addresses.
The report includes current service arguments, potential leftover DPI services,
proxy configuration, DNS lookups and HTTP responses from Discord endpoints.
An HTTP response does not prove that the updater or login works. A service
starting successfully does not prove that the selected profile bypasses the ISP.

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

## Vodafone Zapret2 profile (0.1.4)

Run `install_vodafone_zapret.bat` as administrator after closing manual WinWS2
and GoodbyeDPI windows. It enables Discord-only AdGuard DoH, copies the pinned
WinWS2 runtime into Program Files, and replaces the single G-DPI service profile.
The service starts automatically with Windows; no console window is required.
Other applications using WinDivert are not removed or stopped.

The current strategy was verified on one Vodafone connection for Discord web
login, messages and voice. The user reported approximately 67 ms in that session;
this is not a latency guarantee. The Windows desktop updater still returned a
connection reset and is NOT verified working. TCP 443 processing applies to all
domains, matching the tested configuration; encrypted DNS policy only targets
Discord namespaces. UDP voice traffic is not changed by this profile.

`test_discord_desktop.bat` runs an experimental dynamic TLS strategy with the
PowerShell 5.1 argument quoting issue corrected. It stops G-DPI and requires all
manual DPI windows closed. Keep its window open while restarting desktop Discord.
It does not change DNS or install a second service. After closing the test, run
`install_vodafone_zapret.bat` again to restore the verified web profile.

`service_remove.bat` removes G-DPI and restores its backed-up DNS configuration.
Shared WinDivert drivers are left intact. Existing Superonline installers retain
their previous strategy. Upstream source references and notices are in
`zapret/licenses`; binary hashes and the pinned revision are in `zapret/manifest.json`.
