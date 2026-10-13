# G-DPI

Windows x64 service package with two provider installers:

- `install_superonline.bat`: the existing GoodbyeDPI / Yandex DNS strategy.
- `install_vodafone.bat`: Zapret2 `syndata` with Discord-only AdGuard DoH.

Close Discord and stop any manual GoodbyeDPI or WinWS2 console with Ctrl+C.
Run the appropriate installer as administrator. Both installers configure the
same automatic G-DPI service in `C:\Program Files\G-DPI`. Restart Discord after
installation. No console needs to remain open after service installation.

The Vodafone strategy was verified by the user on one Vodafone connection for
 desktop Discord login and voice, as well as web login, messages and voice.
Approximately 67 ms was reported during the web voice session; latency and
compatibility with other connections are not guaranteed. Service startup on the
target machine still needs validation after replacing the manual console.

Vodafone uses WinWS2 v1.0.5.2 with IPv4 and IPv6 TCP port 443 processing and
`--lua-desync=syndata`. It does not modify UDP voice traffic. HTTPS processing
applies to all domains, matching the tested configuration. This is not a VPN.
AdGuard encrypted DNS policy only targets Discord namespaces. Adapter DNS and
unrelated DNS policies are preserved; plaintext fallback is disabled. Original
DoH configuration is backed up in `ProgramData\G-DPI\dns-backup.json`.

`service_remove.bat` stops and removes G-DPI and restores its backed-up DNS
configuration. Shared WinDivert drivers are preserved. `diagnose.bat` saves a
read-only report and probes Discord endpoints. Probe success does not verify
complete login or voice connectivity.

Both engines are bundled. Runtime hashes are checked before installation.
Zapret2 files are pinned to bundle revision
`6eb463a6758fb48cd101bc55dfd057e6e9d98af1`; the WinWS2 executable is byte-identical
to the user's blockcheck executable. Upstream references and license notices are
in `zapret/licenses` and `engine/licenses`. No VPN runtime or profile backups
are included. Old Vodafone trial installers and the experimental desktop test
are no longer shipped.

Build the ZIP with `node scripts/package.mjs`. The current package contains only
two installation BATs, service removal, diagnostics, service scripts, runtimes
and required notices.