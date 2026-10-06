param([ValidateSet('superonline', 'standard', 'cloudflare')][string]$Profile = 'superonline')
$ErrorActionPreference = 'Stop'
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
  New-Item -ItemType Directory -Force $engineDestination, $serviceDestination | Out-Null
  if ($sourceEngine -ne $engineDestination) { Copy-Item -Path (Join-Path $sourceEngine '*') -Destination $engineDestination -Recurse -Force }
  if ($PSScriptRoot -ne $serviceDestination) { Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $serviceDestination -Force }
  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceDestination 'manage.ps1') -Action install -Profile $Profile
  if ($LASTEXITCODE -ne 0) { throw 'Service installation failed.' }
  Write-Output "Installed to $destination. You may now delete the extracted package."
} catch { Write-Error $_; exit 1 }
