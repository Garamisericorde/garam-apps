function Get-ZapretServiceArguments([string]$EngineDirectory) {
  # Native Windows service command lines need quoted paths. Lua expressions avoid
  # embedded string quotes, which Windows PowerShell 5.1 can remove for EXEs.
  $lua = Join-Path $EngineDirectory 'lua'
  $parts = @(
    ('"--lua-init=@' + (Join-Path $lua 'zapret-lib.lua') + '"'),
    ('"--lua-init=@' + (Join-Path $lua 'zapret-antidpi.lua') + '"'),
    '--wf-l3=ipv4,ipv6',
    '--wf-tcp-out=443',
    '--lua-init=fake_default_tls=tls_mod(fake_default_tls,string.char(114,110,100))',
    '--lua-desync=wssize:wsize=1:scale=6',
    '--payload=tls_client_hello',
    '--lua-desync=tcpseg:pos=0,-1:seqovl=#fake_default_tls:seqovl_pattern=fake_default_tls',
    '--lua-desync=drop'
  )
  return ($parts -join ' ')
}
