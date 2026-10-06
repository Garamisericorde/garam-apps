$ErrorActionPreference = 'Stop'
# The installer runs against isolated directories; simulate a closed Discord.
function global:Get-Process { param($Name, $ErrorAction) return @() }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('g-presets-test-' + [guid]::NewGuid())
$roaming = Join-Path $fixture 'Roaming'
$local = Join-Path $fixture 'Local'
$vencord = Join-Path $roaming 'Vencord'
$resources = Join-Path $local 'discord/app-1.0.0/resources'
New-Item -ItemType Directory -Force (Join-Path $vencord 'dist'), $resources, (Join-Path $roaming 'discord/IndexedDB') | Out-Null
[IO.File]::WriteAllText((Join-Path $vencord 'dist/patcher.js'), 'original-patcher')
[IO.File]::WriteAllText((Join-Path $roaming 'discord/IndexedDB/original.txt'), 'original-indexeddb')
$patcher = Join-Path $vencord 'dist/patcher.js'
[IO.File]::WriteAllText((Join-Path $resources 'app.asar'), ('require(' + ($patcher | ConvertTo-Json -Compress) + ')'))
& (Join-Path $PSScriptRoot 'install.ps1') -RoamingRoot $roaming -LocalRoot $local
$settings = Get-Content (Join-Path $vencord 'settings/settings.json') -Raw | ConvertFrom-Json
if (-not $settings.plugins.ProfilePresets.enabled) { throw 'Plugin was not enabled.' }
$root = Split-Path $PSScriptRoot
$expected = (Get-FileHash (Join-Path $root 'resources/vencord/renderer.js')).Hash
if ((Get-FileHash (Join-Path $vencord 'dist/renderer.js')).Hash -ne $expected) { throw 'Incorrect renderer installed.' }
$backup = Get-ChildItem (Join-Path $local 'G-Presets/backups') -Directory | Select-Object -First 1
if ((Get-Content (Join-Path $backup.FullName 'Vencord/dist/patcher.js') -Raw) -ne 'original-patcher') { throw 'Vencord recovery backup missing.' }
if ((Get-Content (Join-Path $backup.FullName 'IndexedDB/original.txt') -Raw) -ne 'original-indexeddb') { throw 'IndexedDB recovery backup missing.' }
foreach ($source in Get-ChildItem (Join-Path $root 'private/backups/IndexedDB') -Recurse -File) {
  $relative = $source.FullName.Substring((Join-Path $root 'private/backups/IndexedDB').Length).TrimStart('\')
  $target = Join-Path (Join-Path $roaming 'discord/IndexedDB') $relative
  if ((Get-FileHash $source.FullName).Hash -ne (Get-FileHash $target).Hash) { throw "Backup restore mismatch: $relative" }
}
Write-Output 'PASS: plugin deployment, enablement, exact preset database restore and recovery backups.'
