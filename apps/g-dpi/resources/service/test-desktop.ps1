$ErrorActionPreference = 'Stop'
try {
  $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../zapret'))
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this BAT as administrator.' }
  $service = Get-Service G-DPI -ErrorAction SilentlyContinue
  if ($service -and $service.Status -ne 'Stopped') { Stop-Service G-DPI; $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) }
  $other = Get-Process winws2,goodbyedpi -ErrorAction SilentlyContinue
  if ($other) { throw 'Close other DPI engine windows before this test. No unrelated process was stopped.' }
  $arguments = @(
    ('--lua-init=@' + (Join-Path $root 'lua/zapret-lib.lua')),
    ('--lua-init=@' + (Join-Path $root 'lua/zapret-antidpi.lua')),
    '--wf-l3=ipv4,ipv6', '--wf-tcp-out=443',
    '--lua-desync=wssize:wsize=1:scale=6', '--payload=tls_client_hello',
    '--lua-desync=luaexec:code=desync.patmod=tls_mod(fake_default_tls,string.char(114,110,100,44,100,117,112,115,105,100,44,112,97,100,101,110,99,97,112),desync.reasm_data)',
    '--lua-desync=tcpseg:pos=0,-1:seqovl=#patmod:seqovl_pattern=patmod',
    '--lua-desync=drop'
  )
  Write-Output 'Experimental desktop strategy. Keep this window open, then restart Discord.'
  Write-Output 'This does not change DNS. Run dns_adguard_on.bat first if needed.'
  & (Join-Path $root 'winws2.exe') @arguments
  if ($LASTEXITCODE -ne 0) { throw "WinWS2 exited with code $LASTEXITCODE" }
} catch { Write-Error $_; exit 1 }
