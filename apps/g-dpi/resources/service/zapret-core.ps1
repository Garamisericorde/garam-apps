function Get-ZapretServiceArguments([string]$EngineDirectory) {
  # Match the syndata strategy verified for desktop login and voice on Vodafone.
  # Quote Lua library paths for the native Windows service command line.
  $lua = Join-Path $EngineDirectory 'lua'
  $parts = @(
    ('"--lua-init=@' + (Join-Path $lua 'zapret-lib.lua') + '"'),
    ('"--lua-init=@' + (Join-Path $lua 'zapret-antidpi.lua') + '"'),
    '--wf-l3=ipv4,ipv6',
    '--wf-tcp-out=443',
    '--lua-desync=syndata'
  )
  return ($parts -join ' ')
}
