param([ValidateSet('superonline', 'vodafone-zapret')][string]$Profile = 'superonline')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deployment.ps1')
try {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Right-click the provider installation BAT and choose Run as administrator.'
  }
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'G-DPI requires Windows x64.' }
  if (Get-Service GoodbyeDPI -ErrorAction SilentlyContinue) { throw 'Remove the existing GoodbyeDPI service using its own removal script first.' }
  $sourceEngine = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../engine'))
  $manifest = Get-Content -LiteralPath (Join-Path $sourceEngine 'manifest.json') -Raw | ConvertFrom-Json
  foreach ($name in @('goodbyedpi.exe', 'WinDivert.dll', 'WinDivert64.sys')) {
    if ((Get-FileHash -LiteralPath (Join-Path $sourceEngine $name)).Hash -ne $manifest.files.$name) { throw "Engine integrity check failed: $name" }
  }
  if ($Profile -eq 'superonline') {
    . (Join-Path $PSScriptRoot 'superonline-core.ps1')
    Assert-DiscordDomainList (Join-Path $sourceEngine 'discord-domains.txt')
  }
  $destination = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'G-DPI'
  $engineDestination = Join-Path $destination 'engine'
  $serviceDestination = Join-Path $destination 'service'
  $existing = Get-Service G-DPI -ErrorAction SilentlyContinue
  if ($existing -and $existing.Status -ne 'Stopped') {
    Stop-Service G-DPI
    $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
  }
  Stop-InstalledEngine (Join-Path $engineDestination 'goodbyedpi.exe')
  Stop-InstalledEngine (Join-Path $destination 'zapret/winws2.exe')
  New-Item -ItemType Directory -Force $engineDestination, $serviceDestination | Out-Null
  if ($sourceEngine -ne $engineDestination) {
    foreach ($file in Get-ChildItem -LiteralPath $sourceEngine -File) {
      Copy-EngineFile $file.FullName (Join-Path $engineDestination $file.Name)
    }
    Copy-Item -LiteralPath (Join-Path $sourceEngine 'licenses') -Destination $engineDestination -Recurse -Force
  }
  if ($Profile -eq 'vodafone-zapret') {
    $sourceZapret = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../zapret'))
    $zapretManifest = Get-Content -LiteralPath (Join-Path $sourceZapret 'manifest.json') -Raw | ConvertFrom-Json
    foreach ($entry in $zapretManifest.files.PSObject.Properties) {
      if ((Get-FileHash -LiteralPath (Join-Path $sourceZapret $entry.Name)).Hash -ne $entry.Value) { throw "Zapret integrity check failed: $($entry.Name)" }
    }
    $zapretDestination = Join-Path $destination 'zapret'
    foreach ($file in Get-ChildItem -LiteralPath $sourceZapret -Recurse -File) {
      $relative = $file.FullName.Substring($sourceZapret.Length + 1)
      $target = Join-Path $zapretDestination $relative
      New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
      if ($file.FullName -ne $target) { Copy-EngineFile $file.FullName $target }
    }
  }
  if ($PSScriptRoot -ne $serviceDestination) { Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $serviceDestination -Force }
  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceDestination 'manage.ps1') -Action install -Profile $Profile
  if ($LASTEXITCODE -ne 0) { throw 'Service installation failed.' }
  Write-Output "Installed to $destination. You may now delete the extracted package."
} catch { Write-Error $_; exit 1 }
