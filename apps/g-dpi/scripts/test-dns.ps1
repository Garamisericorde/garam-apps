$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../resources/service/dns-core.ps1')
$script:rules = @([pscustomobject]@{Name='other'; Namespace=@('.company.test'); Comment='Unrelated'})
$script:doh = $null
$script:failResolution = $false
function Get-DnsClientNrptRule { return $script:rules }
function Remove-DnsClientNrptRule { param($Name,[switch]$Force) $script:rules=@($script:rules | Where-Object Name -NE $Name) }
function Add-DnsClientNrptRule { param($Namespace,$NameServers,$Comment) $script:rules += [pscustomobject]@{Name='ours'; Namespace=$Namespace; Comment=$Comment; NameServers=$NameServers} }
function Get-DnsClientDohServerAddress { param($ServerAddress,$ErrorAction) return $script:doh }
function Add-DnsClientDohServerAddress { param($ServerAddress,$DohTemplate,$AutoUpgrade,$AllowFallbackToUdp) $script:doh=[pscustomobject]@{DohTemplate=$DohTemplate;AutoUpgrade=$AutoUpgrade;AllowFallbackToUdp=$AllowFallbackToUdp} }
function Set-DnsClientDohServerAddress { param($ServerAddress,$DohTemplate,$AutoUpgrade,$AllowFallbackToUdp) Add-DnsClientDohServerAddress @PSBoundParameters }
function Remove-DnsClientDohServerAddress { param($ServerAddress,$Confirm) $script:doh=$null }
function Get-Service { param($Name,$ErrorAction) return $null }
function Clear-DnsClientCache {}
function Assert-DiscordResolution { if($script:failResolution){throw 'Simulated DNS failure'} }
$folder = Join-Path $env:TEMP ('g-dpi-dns-test-'+[guid]::NewGuid())
$state = Join-Path $folder 'backup.json'
Enable-GDpiDns $state
Enable-GDpiDns $state
if($script:rules.Count -ne 2 -or $script:doh.AllowFallbackToUdp -or -not $script:doh.AutoUpgrade){throw 'Repeated enable changed policy or allowed plaintext fallback'}
Restore-GDpiDns $state
if($script:rules.Count -ne 1 -or $script:rules[0].Name -ne 'other' -or $script:doh){throw 'Restore did not preserve unrelated state'}
Write-Output 'PASS: repeated enable and restore preserve unrelated DNS policies.'
$script:doh=[pscustomobject]@{DohTemplate='https://existing.test/dns-query';AutoUpgrade=$false;AllowFallbackToUdp=$true}
$script:failResolution=$true
$failed=$false
try{Enable-GDpiDns $state}catch{$failed=$true}
if(-not $failed -or $script:doh.DohTemplate -ne 'https://existing.test/dns-query' -or $script:rules.Count -ne 1){throw 'Failure did not roll back original settings'}
Write-Output 'PASS: DNS resolution failure rolls back the original DoH configuration.'
$script:rules += [pscustomobject]@{Name='existing-discord';Namespace=@('.discord.com');Comment='Other app'}
$failed=$false
try{Enable-GDpiDns $state}catch{$failed=$true}
if(-not $failed -or $script:rules.Count -ne 2){throw 'Conflicting policy was not preserved'}
Write-Output 'PASS: existing Discord policy is rejected without modification.'
