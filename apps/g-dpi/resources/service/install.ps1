param([ValidateSet('superonline', 'standard', 'cloudflare', 'vodafone-1', 'vodafone-2', 'vodafone-3', 'vodafone-4', 'vodafone-5', 'vodafone-6', 'adguard-1', 'adguard-2', 'adguard-3', 'adguard-4')][string]$Profile = 'superonline')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deployment.ps1')
try {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Right-click service_install.bat and choose Run as administrator.'
  }
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'G-DPI requires Windows x64.' }
  if (Get-Service GoodbyeDPI -ErrorAction SilentlyContinue) { throw 'Remove the existing GoodbyeDPI service using its own removal script first.' }
  $sourceEngine = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../engine'))
  $manifest = Get-Content -LiteralPath (Join-Path $sourceEngine 'manifest.json') -Raw | ConvertFrom-Json
  foreach ($name in @('goodbyedpi.exe', 'WinDivert.dll', 'WinDivert64.sys')) {
    if ((Get-FileHash -LiteralPath (Join-Path $sourceEngine $name)).Hash -ne $manifest.files.$name) { throw "Engine integrity check failed: $name" }
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
  New-Item -ItemType Directory -Force $engineDestination, $serviceDestination | Out-Null
  if ($sourceEngine -ne $engineDestination) {
    foreach ($file in Get-ChildItem -LiteralPath $sourceEngine -File) {
      Copy-EngineFile $file.FullName (Join-Path $engineDestination $file.Name)
    }
    Copy-Item -LiteralPath (Join-Path $sourceEngine 'licenses') -Destination $engineDestination -Recurse -Force
  }
  if ($PSScriptRoot -ne $serviceDestination) { Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $serviceDestination -Force }
  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceDestination 'manage.ps1') -Action install -Profile $Profile
  if ($LASTEXITCODE -ne 0) { throw 'Service installation failed.' }
  Write-Output "Installed to $destination. You may now delete the extracted package."
} catch { Write-Error $_; exit 1 }
