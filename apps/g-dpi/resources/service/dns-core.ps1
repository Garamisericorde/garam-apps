function Save-DnsState($State, [string]$Path) {
  New-Item -ItemType Directory -Force (Split-Path $Path) | Out-Null
  [IO.File]::WriteAllText(($Path + '.tmp'), ($State | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath ($Path + '.tmp') -Destination $Path -Force
}

function Assert-DiscordResolution {
  if (-not ([Net.Dns]::GetHostAddresses('discord.com')).Count) { throw 'Windows DNS did not resolve Discord.' }
}

function Restore-GDpiDns([string]$StatePath) {
  if (-not (Test-Path -LiteralPath $StatePath)) { Write-Output 'No G-DPI DNS backup to restore.'; return }
  $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  Get-DnsClientNrptRule | Where-Object Comment -EQ 'G-DPI AdGuard DoH' | ForEach-Object {
    Remove-DnsClientNrptRule -Name $_.Name -Force
  }
  $current = Get-DnsClientDohServerAddress -ServerAddress '94.140.14.14' -ErrorAction SilentlyContinue
  if ($current -and $current.DohTemplate -eq 'https://dns.adguard-dns.com/dns-query' -and $current.AutoUpgrade -and -not $current.AllowFallbackToUdp) {
    if ($state.PreviousDoh) {
      Set-DnsClientDohServerAddress -ServerAddress '94.140.14.14' -DohTemplate $state.PreviousDoh.DohTemplate -AutoUpgrade ([bool]$state.PreviousDoh.AutoUpgrade) -AllowFallbackToUdp ([bool]$state.PreviousDoh.AllowFallbackToUdp)
    } else { Remove-DnsClientDohServerAddress -ServerAddress '94.140.14.14' -Confirm:$false }
  }
  if ($state.DpiWasRunning -and (Get-Service G-DPI -ErrorAction SilentlyContinue)) {
    $currentDpi = Get-CimInstance Win32_Service -Filter "Name='G-DPI'"
    if ($state.DpiPath -and $currentDpi.PathName -eq $state.DpiPath) { Start-Service G-DPI }
    else { Stop-Service G-DPI; Write-Output 'DPI profile changed after DNS setup; it was left stopped.' }
  }
  Clear-DnsClientCache
  Move-Item -LiteralPath $StatePath -Destination ($StatePath + '.restored-' + [guid]::NewGuid())
  Write-Output 'Previous DNS settings restored.'
}

function Enable-GDpiDns([string]$StatePath) {
  $server = '94.140.14.14'
  $template = 'https://dns.adguard-dns.com/dns-query'
  $namespaces = @('discord.com', '.discord.com', 'discord.gg', '.discord.gg', 'discordapp.com', '.discordapp.com', 'discordapp.net', '.discordapp.net', 'discord.media', '.discord.media', 'discordcdn.com', '.discordcdn.com')
  $conflict = Get-DnsClientNrptRule | Where-Object { $_.Comment -ne 'G-DPI AdGuard DoH' -and @($_.Namespace | Where-Object { $_ -in $namespaces }).Count -gt 0 }
  if ($conflict) { throw 'An existing DNS policy targets Discord. It was left unchanged.' }
  $existing = Get-DnsClientDohServerAddress -ServerAddress $server -ErrorAction SilentlyContinue
  $dpi = Get-Service G-DPI -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $StatePath)) {
    $previous = if ($existing) { @{ DohTemplate=$existing.DohTemplate; AutoUpgrade=$existing.AutoUpgrade; AllowFallbackToUdp=$existing.AllowFallbackToUdp } } else { $null }
    $dpiPath = if ($dpi) { (Get-CimInstance Win32_Service -Filter "Name='G-DPI'").PathName } else { $null }
    Save-DnsState @{ PreviousDoh=$previous; DpiWasRunning=([bool]($dpi -and $dpi.Status -eq 'Running')); DpiPath=$dpiPath } $StatePath
  }
  try {
    if ($dpi -and $dpi.Status -ne 'Stopped') { Stop-Service G-DPI; $dpi.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) }
    if ($existing) { Set-DnsClientDohServerAddress -ServerAddress $server -DohTemplate $template -AutoUpgrade $true -AllowFallbackToUdp $false }
    else { Add-DnsClientDohServerAddress -ServerAddress $server -DohTemplate $template -AutoUpgrade $true -AllowFallbackToUdp $false }
    Get-DnsClientNrptRule | Where-Object Comment -EQ 'G-DPI AdGuard DoH' | ForEach-Object { Remove-DnsClientNrptRule -Name $_.Name -Force }
    Add-DnsClientNrptRule -Namespace $namespaces -NameServers $server -Comment 'G-DPI AdGuard DoH'
    Clear-DnsClientCache
    # Use the normal Windows resolver rather than a manually pinned DoH request.
    Assert-DiscordResolution
    Write-Output 'AdGuard encrypted DNS enabled for Discord domains. Other DNS and adapter settings are unchanged.'
    Write-Output 'Encrypted DNS is ready. The installer will start the selected G-DPI service profile.'
  } catch {
    $failure = $_
    try { Restore-GDpiDns $StatePath } catch { Write-Warning 'Automatic DNS rollback failed. Run dns_restore.bat as administrator.' }
    throw $failure
  }
}
