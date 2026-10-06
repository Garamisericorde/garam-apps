param(
  [ValidateSet('install', 'remove', 'status')][string]$Action = 'status',
  [ValidateSet('superonline', 'standard', 'cloudflare')][string]$Profile = 'superonline'
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
    $profiles = @{
      superonline = '-5 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253'
      standard = '-5'
      cloudflare = '-5 --dns-addr 1.1.1.1 --dns-port 53 --dnsv6-addr 2606:4700:4700::1111 --dnsv6-port 53'
    }
    $binaryPath = '"' + $engine + '" ' + $profiles[$Profile]
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
    Write-Output "Running ($Profile). Test Discord connectivity from G-DPI."
  } else {
    if ($service) {
      if ($service.Status -ne 'Stopped') { Stop-Service $serviceName; $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) }
      & sc.exe delete $serviceName | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Service deletion failed: $LASTEXITCODE" }
    }
    Write-Output 'G-DPI removed. Shared WinDivert drivers and system DNS settings were left intact.'
  }
} catch { Write-Error $_; exit 1 }
