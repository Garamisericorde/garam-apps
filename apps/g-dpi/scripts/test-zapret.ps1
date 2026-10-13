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
