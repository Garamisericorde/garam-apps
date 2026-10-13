param([ValidateSet('enable','restore')][string]$Action = 'enable')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dns-core.ps1')
try {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this BAT file as administrator.' }
  foreach ($command in @('Add-DnsClientDohServerAddress','Set-DnsClientDohServerAddress','Remove-DnsClientDohServerAddress','Add-DnsClientNrptRule','Get-DnsClientNrptRule')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw 'Encrypted DNS mode requires supported Windows 11 DNS commands.' }
  }
  $state = Join-Path $env:ProgramData 'G-DPI/dns-backup.json'
  if ($Action -eq 'enable') { Enable-GDpiDns $state } else { Restore-GDpiDns $state }
} catch { Write-Error $_; exit 1 }
