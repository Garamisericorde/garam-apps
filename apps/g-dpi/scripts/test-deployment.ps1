$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../resources/service/deployment.ps1')
$fixture = Join-Path $env:TEMP ('g-dpi-copy-test-' + [guid]::NewGuid())
New-Item -ItemType Directory $fixture | Out-Null
$source = Join-Path $fixture 'source.exe'
$destination = Join-Path $fixture 'installed.exe'
[IO.File]::WriteAllText($source, 'same engine')
[IO.File]::WriteAllText($destination, 'same engine')
$lock = [IO.File]::Open($destination, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
  Copy-EngineFile $source $destination
  Write-Output 'PASS: identical locked executable was not overwritten.'
  [IO.File]::WriteAllText($source, 'new engine')
  $blocked = $false
  try { Copy-EngineFile $source $destination } catch { $blocked = $_.Exception.Message -like '*Restart Windows*' }
  if (-not $blocked) { throw 'Locked update did not report the recovery instruction.' }
  Write-Output 'PASS: changed locked executable gives an actionable error.'
} finally { $lock.Dispose() }
Copy-EngineFile $source $destination
if ((Get-Content $destination -Raw) -ne 'new engine') { throw 'Unlocked update failed.' }
Write-Output 'PASS: changed unlocked executable was updated.'
