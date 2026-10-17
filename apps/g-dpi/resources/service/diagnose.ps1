$ErrorActionPreference = 'Continue'
$report = Join-Path $env:TEMP ('G-DPI-diagnostics-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
Start-Transcript -LiteralPath $report | Out-Null
try {
  Write-Output 'G-DPI diagnostics. No settings are changed.'
  if (Get-Command Get-DnsClientDohServerAddress -ErrorAction SilentlyContinue) {
    Get-DnsClientDohServerAddress -ServerAddress '94.140.14.14' -ErrorAction SilentlyContinue | Format-List ServerAddress,DohTemplate,AutoUpgrade,AllowFallbackToUdp
    Get-DnsClientNrptRule | Where-Object Comment -EQ 'G-DPI AdGuard DoH' | Format-List Name,Namespace,NameServers,Comment
  }
  Get-CimInstance Win32_Service | Where-Object { $_.Name -eq 'G-DPI' -or $_.Name -match 'Goodbye|WinDivert|Yoga|Splitwire' -or $_.PathName -match 'goodbyedpi|yogadns|splitwire' } | Select-Object Name,State,StartMode,PathName | Format-List
  Get-CimInstance Win32_Process -Filter "Name='goodbyedpi.exe' OR Name='winws2.exe'" | Select-Object ProcessId,ExecutablePath | Format-List
  Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses.Count -gt 0 } | Select-Object InterfaceAlias,AddressFamily,ServerAddresses | Format-Table -AutoSize
  netsh.exe winhttp show proxy
  $proxy = Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Internet Settings' -ErrorAction SilentlyContinue
  Write-Output "User proxy enabled: $($proxy.ProxyEnable); automatic proxy script configured: $([bool]$proxy.AutoConfigURL)"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  foreach ($uri in @('https://discord.com/api/v10/gateway', 'https://discord.com/api/updates/stable?platform=win', 'https://updates.discord.com/distributions/app/manifests/latest?channel=stable&platform=win&arch=x64', 'https://cdn.discordapp.com/', 'https://www.google.com/', 'https://www.curseforge.com/', 'https://www.speedtest.com/', 'https://www.speedtest.net/')) {
    $hostName = ([uri]$uri).DnsSafeHost
    try { Resolve-DnsName $hostName -Type A -ErrorAction Stop | Where-Object IPAddress | Select-Object Name,IPAddress | Format-Table } catch { Write-Output "DNS failed for ${hostName}: $($_.Exception.Message)" }
    try {
      $response = Invoke-WebRequest $uri -UseBasicParsing -TimeoutSec 12 -ErrorAction Stop
      Write-Output "${uri}: HTTP $([int]$response.StatusCode)"
    } catch {
      if ($_.Exception.Response) { Write-Output "${uri}: HTTP $([int]$_.Exception.Response.StatusCode) (host responded; endpoint may reject this probe)" }
      else { Write-Output "${uri}: connection failed - $($_.Exception.Message)" }
    }
  }
  Write-Output 'These checks do not verify account login, voice or a complete Discord update.'
} finally { Stop-Transcript | Out-Null }
Write-Output "Report saved: $report"
