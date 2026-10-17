function Assert-DiscordDomainList([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'Discord domain list is missing. Refusing to start an unrestricted engine.'
  }
  $allowed = @('discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media', 'discordcdn.com')
  $domains = @(Get-Content -LiteralPath $Path | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ -and -not $_.StartsWith('#') })
  if (-not $domains.Count -or 'discord.com' -notin $domains -or @($domains | Where-Object { $_ -notin $allowed }).Count) {
    throw 'Invalid Discord domain list. Refusing to apply DPI processing to unrelated hosts.'
  }
}

function Get-SuperonlineServiceArguments([string]$EngineDirectory, [string]$Template) {
  # --blacklist scopes GoodbyeDPI packet transformations to HTTP Host / TLS SNI.
  # DNS redirection is independent of this filter and must never be added here.
  if ($Template -ne '-5 --blacklist {discordList}') { throw 'Unsafe Superonline profile: expected Discord-only DPI and no DNS redirection.' }
  $list = Join-Path $EngineDirectory 'discord-domains.txt'
  Assert-DiscordDomainList $list
  return $Template.Replace('{discordList}', ('"' + $list + '"'))
}
