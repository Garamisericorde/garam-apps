$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../resources/service/zapret-core.ps1')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GDpiArgv {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  static extern IntPtr CommandLineToArgvW(string command, out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  public static string[] Parse(string command) {
    int count; IntPtr memory=CommandLineToArgvW(command, out count);
    if(memory==IntPtr.Zero) throw new Exception("Argument parsing failed");
    try {
      string[] result=new string[count];
      for(int i=0;i<count;i++) result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory,i*IntPtr.Size));
      return result;
    } finally {LocalFree(memory);}
  }
}
'@
$directory = 'C:\Program Files\G-DPI\zapret'
$command = '"' + $directory + '\winws2.exe" ' + (Get-ZapretServiceArguments $directory)
$arguments = [GDpiArgv]::Parse($command)
if ($arguments.Count -ne 6) { throw "Unexpected argument count: $($arguments.Count)" }
if ($arguments[1] -ne "--lua-init=@$directory\lua\zapret-lib.lua") { throw 'Library path quoting failed.' }
if ($arguments[2] -ne "--lua-init=@$directory\lua\zapret-antidpi.lua") { throw 'Antidpi path quoting failed.' }
if ($arguments[5] -ne '--lua-desync=syndata') { throw 'The verified Vodafone strategy was changed.' }
. (Join-Path $PSScriptRoot '../resources/service/superonline-core.ps1')
$scopeFolder = Join-Path $env:TEMP ('g-dpi scope test ' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $scopeFolder | Out-Null
$scopeList = Join-Path $scopeFolder 'discord-domains.txt'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../resources/engine/discord-domains.txt') -Destination $scopeList
$scopeArguments = Get-SuperonlineServiceArguments $scopeFolder '-5 --blacklist {discordList}'
$parsed = [GDpiArgv]::Parse(('"C:\Program Files\G-DPI\engine\goodbyedpi.exe" ' + $scopeArguments))
if ($parsed.Count -ne 4 -or $parsed[2] -ne '--blacklist' -or $parsed[3] -ne $scopeList) { throw 'Superonline domain-list path quoting failed.' }
foreach ($bad in @('', '*', 'com', 'google.com', 'discord.com.evil.test')) {
  [IO.File]::WriteAllText($scopeList, "discord.com`n$bad")
  if ($bad -eq '') { [IO.File]::WriteAllText($scopeList, '') }
  $rejected = $false
  try { Get-SuperonlineServiceArguments $scopeFolder '-5 --blacklist {discordList}' | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw "Unsafe domain list was accepted: $bad" }
}
$rejected = $false
try { Get-SuperonlineServiceArguments (Join-Path $scopeFolder 'missing') '-5 --blacklist {discordList}' | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'A missing domain list did not stop installation.' }
foreach ($unsafe in @('-5', '-5 --dns-addr 77.88.8.8', '-5 --blacklist {discordList} --allow-no-sni')) {
  $rejected = $false
  try { Get-SuperonlineServiceArguments $scopeFolder $unsafe | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw 'A global or DNS-redirecting profile was accepted.' }
}
Write-Output 'PASS: Superonline fails closed for missing/broad lists and rejects global DNS redirection.'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../resources/zapret'))
$manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files.PSObject.Properties) {
  if ((Get-FileHash -LiteralPath (Join-Path $root $entry.Name)).Hash -ne $entry.Value) { throw "Hash mismatch: $($entry.Name)" }
}
foreach ($script in Get-ChildItem (Join-Path $PSScriptRoot '../resources/service') -Filter '*.ps1') {
  $tokens=$null; $errors=$null
  [Management.Automation.Language.Parser]::ParseFile($script.FullName,[ref]$tokens,[ref]$errors) | Out-Null
  if ($errors) { throw "$($script.Name): $errors" }
}
Write-Output 'PASS: native service argument parsing, runtime hashes and PowerShell syntax.'
