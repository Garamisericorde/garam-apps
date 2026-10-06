param([string]$Gh = 'gh', [string]$Target = 'codex/setup-release')
$ErrorActionPreference = 'Stop'
$repo = 'Garamisericorde/garam-apps'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$catalog = Get-Content -LiteralPath (Join-Path $root 'catalog.json') -Raw | ConvertFrom-Json
& $Gh auth status
if ($LASTEXITCODE -ne 0) { throw 'GitHub login required: gh auth login --web --scopes workflow' }
$releaseList = & $Gh release list --repo $repo --limit 200 --json tagName
if ($LASTEXITCODE -ne 0) { throw 'Could not read GitHub releases' }
$knownTags = @($releaseList | ConvertFrom-Json | ForEach-Object tagName)
foreach ($app in $catalog.apps) {
  $tag = "$($app.id)-v$($app.version)"
  $artifact = Join-Path $root ("apps/$($app.id)/release/$($app.installer.fileName)")
  if ((Get-FileHash -LiteralPath $artifact).Hash -ne $app.installer.sha256) { throw "Artifact changed after catalog generation: $($app.name)" }
  if ($tag -notin $knownTags) {
    & $Gh release create $tag --repo $repo --target $Target --title "$($app.name) $($app.version)" --notes "$($app.description)" --latest=false
    if ($LASTEXITCODE -ne 0) { throw "Release creation failed: $tag" }
  }
  & $Gh release upload $tag $artifact --repo $repo --clobber
  if ($LASTEXITCODE -ne 0) { throw "Asset upload failed: $tag" }
}
# Publish the catalog only after every referenced asset exists.
if ('catalog' -notin $knownTags) {
  & $Gh release create catalog --repo $repo --title 'Garam app catalog' --notes 'Live application list used by Garam Setup.' --latest=false
  if ($LASTEXITCODE -ne 0) { throw 'Catalog release creation failed' }
}
& $Gh release upload catalog (Join-Path $root 'catalog.json') --repo $repo --clobber
if ($LASTEXITCODE -ne 0) { throw 'Catalog upload failed' }
Write-Output 'All installers and the live catalog are published.'
