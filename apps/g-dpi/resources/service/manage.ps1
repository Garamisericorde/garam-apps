param(
  [ValidateSet('install', 'remove', 'status')][string]$Action = 'status',
  [ValidateSet('superonline', 'standard', 'cloudflare', 'vodafone-1', 'vodafone-2', 'vodafone-3', 'vodafone-4', 'vodafone-5', 'vodafone-6', 'adguard-1', 'adguard-2', 'adguard-3', 'adguard-4')][string]$Profile = 'superonline'
)
$ErrorActionPreference = 'Stop'
$serviceName = 'G-DPI'
try {
  if ($Action -eq 'status') {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service) { Write-Output $service.Status } else { Write-Output 'Not installed' }
    exit 0
  }
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator privileges required. Run G-DPI or the BAT file as administrator.'
  }
  # Only manage our own service. Other applications may share WinDivert.
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($Action -eq 'install') {
    if (Get-Service -Name 'GoodbyeDPI' -ErrorAction SilentlyContinue) {
      throw 'An existing GoodbyeDPI service was found. Remove it with its own uninstaller first.'
    }
    $engine = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../engine/goodbyedpi.exe'))
    $manifestPath = Join-Path (Split-Path $engine) 'manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($entry in $manifest.files.PSObject.Properties) {
      $file = Join-Path (Split-Path $engine) $entry.Name
      if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.Value) { throw "Engine integrity check failed: $($entry.Name)" }
    }
    $profiles = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'profiles.json') -Raw | ConvertFrom-Json
    $selected = $profiles.PSObject.Properties[$Profile].Value
    if (-not $selected.args) { throw 'Selected profile was not found.' }
    if ($Profile -like 'adguard-*') {
      & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dns.ps1') -Action enable
      if ($LASTEXITCODE -ne 0) { throw 'Encrypted DNS configuration failed; service was not started.' }
    }
    $arguments = $selected.args.Replace('{discordList}', ('"' + (Join-Path (Split-Path $engine) 'discord-domains.txt') + '"'))
    $binaryPath = '"' + $engine + '" ' + $arguments
    if ($service) {
      if ($service.Status -ne 'Stopped') { Stop-Service $serviceName; $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) }
      $cimService = Get-CimInstance Win32_Service -Filter "Name='G-DPI'"
      $result = Invoke-CimMethod -InputObject $cimService -MethodName Change -Arguments @{ PathName = $binaryPath; StartMode = 'Automatic' }
      if ($result.ReturnValue -ne 0) { throw "Service configuration failed: $($result.ReturnValue)" }
    } else {
      New-Service -Name $serviceName -BinaryPathName $binaryPath -StartupType Automatic -DisplayName 'G-DPI (GoodbyeDPI)' -Description 'G-DPI network access service powered by GoodbyeDPI' | Out-Null
    }
    Start-Service $serviceName
    (Get-Service $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
    Start-Sleep -Seconds 2
    if ((Get-Service $serviceName).Status -ne 'Running') { throw 'The engine exited after startup. Check Windows Event Viewer.' }
    Write-Output "Running ($($selected.label)). This confirms service startup, not Discord access. Close and restart Discord to test."
  } else {
    if (Test-Path -LiteralPath (Join-Path $env:ProgramData 'G-DPI/dns-backup.json')) {
      & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dns.ps1') -Action restore
      if ($LASTEXITCODE -ne 0) { throw 'Restore encrypted DNS settings before removing the service.' }
      $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    }
    if ($service) {
      if ($service.Status -ne 'Stopped') { Stop-Service $serviceName; $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) }
      & sc.exe delete $serviceName | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Service deletion failed: $LASTEXITCODE" }
    }
    Write-Output 'G-DPI removed. Shared WinDivert drivers and system DNS settings were left intact.'
  }
} catch { Write-Error $_; exit 1 }
