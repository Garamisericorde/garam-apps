function Copy-EngineFile([string]$Source, [string]$Destination) {
  # Loaded executables and drivers can be locked even after a service stops.
  # Identical files never need to be overwritten.
  if ((Test-Path -LiteralPath $Destination) -and
      (Get-FileHash -LiteralPath $Source).Hash -eq (Get-FileHash -LiteralPath $Destination).Hash) {
    return
  }
  try { Copy-Item -LiteralPath $Source -Destination $Destination -Force }
  catch { throw "Cannot update $Destination. Restart Windows, then run the installer before launching another DPI tool. Original error: $($_.Exception.Message)" }
}

function Stop-InstalledEngine([string]$EnginePath) {
  $expected = [IO.Path]::GetFullPath($EnginePath)
  # Only stop this installation's engine, never another application's process.
  $processes = Get-CimInstance Win32_Process -Filter "Name='goodbyedpi.exe'"
  foreach ($process in $processes) {
    if ($process.ExecutablePath -and [IO.Path]::GetFullPath($process.ExecutablePath) -eq $expected) {
      $running = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
      if ($running -and $running.Path -and [IO.Path]::GetFullPath($running.Path) -eq $expected) {
        Stop-Process -Id $running.Id -Force
        if (-not $running.WaitForExit(20000)) { throw "G-DPI process $($running.Id) did not exit. Restart Windows and retry." }
      }
    }
  }
}
