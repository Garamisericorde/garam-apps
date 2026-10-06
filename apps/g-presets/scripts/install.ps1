param(
  [ValidateSet('discord','discordptb','discordcanary')][string]$Channel = 'discord',
  [string]$RoamingRoot = [Environment]::GetFolderPath('ApplicationData'),
  [string]$LocalRoot = [Environment]::GetFolderPath('LocalApplicationData'),
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path $PSScriptRoot
$replaced = @()
$created = @()
try {
  if (-not $DryRun -and (Get-Process Discord,DiscordPTB,DiscordCanary,Vesktop -ErrorAction SilentlyContinue)) { throw 'Close Discord completely, including the system tray, before installing.' }
  $vencordRoot = [IO.Path]::GetFullPath((Join-Path $RoamingRoot 'Vencord'))
  $dist = Join-Path $vencordRoot 'dist'
  $appFolders = @(Get-ChildItem -LiteralPath (Join-Path $LocalRoot $Channel) -Directory -Filter 'app-*' -ErrorAction SilentlyContinue | Sort-Object { try { [version]$_.Name.Substring(4) } catch { [version]'0.0' } } -Descending)
  if (-not $appFolders.Count) { throw "No installed $Channel client found." }
  $loader = Join-Path $appFolders[0].FullName 'resources/app.asar'
  $loaderText = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($loader))
  $match = [regex]::Match($loaderText, 'require\(("(?:\\.|[^"\\])*patcher\.js")\)')
  if (-not $match.Success) { throw 'No existing Vencord loader found. Install Vencord first.' }
  $patcherPath = $match.Groups[1].Value | ConvertFrom-Json
  if ([IO.Path]::GetFullPath($patcherPath) -ne (Join-Path $dist 'patcher.js')) { throw "Custom Vencord location detected: $patcherPath. This installer supports the standard AppData Vencord installation." }
  if (-not (Test-Path -LiteralPath $patcherPath)) { throw 'The installed Vencord files are missing.' }
  $manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'resources/manifest.json') -Raw | ConvertFrom-Json
  foreach ($entry in $manifest.files.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $packageRoot ('resources/vencord/' + $entry.Name))).Hash -ne $entry.Value) { throw "Bundle integrity check failed: $($entry.Name)" }
  }
  $backupSource = Join-Path $packageRoot 'private/backups'
  $indexedTarget = Join-Path (Join-Path $RoamingRoot $Channel) 'IndexedDB'
  Write-Output "Vencord target: $dist"
  Write-Output "Discord data target: $indexedTarget"
  if ($DryRun) { Write-Output 'Dry run passed; no files changed.'; exit 0 }
  $rollbackRoot = Join-Path (Join-Path $LocalRoot 'G-Presets/backups') ([guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Force $rollbackRoot | Out-Null
  Write-Output "Recovery backup: $rollbackRoot"
  function Save-Target([string]$target, [string]$label) {
    $resolvedTarget = [IO.Path]::GetFullPath($target)
    if ($resolvedTarget -notin @($vencordRoot, [IO.Path]::GetFullPath($indexedTarget))) { throw 'Unexpected replacement target.' }
    if ([IO.Path]::GetFullPath((Join-Path $rollbackRoot $label)) -notlike ([IO.Path]::GetFullPath($rollbackRoot) + '\*')) { throw 'Backup path escaped the recovery directory.' }
    if (Test-Path -LiteralPath $target) {
      $backup = Join-Path $rollbackRoot $label
      Move-Item -LiteralPath $target -Destination $backup
      $script:replaced += @{ Target=$target; Backup=$backup }
    } else { $script:created += $target }
  }
  Save-Target $vencordRoot 'Vencord'
  $oldVencord = Join-Path $rollbackRoot 'Vencord'
  if (Test-Path -LiteralPath $oldVencord) { Copy-Item -LiteralPath $oldVencord -Destination $vencordRoot -Recurse } else { New-Item -ItemType Directory $vencordRoot | Out-Null }
  foreach ($folder in @('settings','themes')) {
    $source = Join-Path $backupSource ('Vencord/' + $folder)
    if (Test-Path -LiteralPath $source) {
      $target = Join-Path $vencordRoot $folder
      New-Item -ItemType Directory -Force $target | Out-Null
      Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
    }
  }
  New-Item -ItemType Directory -Force $dist | Out-Null
  Copy-Item -Path (Join-Path $packageRoot 'resources/vencord/*') -Destination $dist -Force
  $settingsPath = Join-Path $vencordRoot 'settings/settings.json'
  New-Item -ItemType Directory -Force (Split-Path $settingsPath) | Out-Null
  $settings = if (Test-Path -LiteralPath $settingsPath) { Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json } else { New-Object PSObject }
  if (-not $settings.plugins) { $settings | Add-Member -NotePropertyName plugins -NotePropertyValue (New-Object PSObject) -Force }
  if (-not $settings.plugins.ProfilePresets) { $settings.plugins | Add-Member -NotePropertyName ProfilePresets -NotePropertyValue (New-Object PSObject) -Force }
  $settings.plugins.ProfilePresets | Add-Member -NotePropertyName enabled -NotePropertyValue $true -Force
  [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 100), (New-Object Text.UTF8Encoding($false)))
  $indexedSource = Join-Path $backupSource 'IndexedDB'
  if (Test-Path -LiteralPath $indexedSource) {
    Save-Target $indexedTarget 'IndexedDB'
    Copy-Item -LiteralPath $indexedSource -Destination $indexedTarget -Recurse
  }
  Write-Output 'Installed ProfilePresets. Personal presets restored if bundled. Restart Discord.'
} catch {
  foreach ($entry in $replaced) {
    if (Test-Path -LiteralPath $entry.Target) { Move-Item -LiteralPath $entry.Target -Destination ($entry.Backup + '-failed') }
    Move-Item -LiteralPath $entry.Backup -Destination $entry.Target
  }
  foreach ($target in $created) { if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination (Join-Path $rollbackRoot ([IO.Path]::GetFileName($target) + '-failed-new')) } }
  Write-Error $_
  exit 1
}
