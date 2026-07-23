# publish-all.ps1 — Build and publish all three npm packages to registry.npmjs.org
#
# Usage:
#   $env:NPM_TOKEN = "npm_xxxxxxxx..."
#   .\scripts\publish-all.ps1
#
# Optional flags:
#   .\scripts\publish-all.ps1 -DryRun          # simulate without uploading
#   .\scripts\publish-all.ps1 -Package client  # publish one package only (client|server|mcp)

param(
  [switch]$DryRun,
  [ValidateSet('client', 'server', 'mcp', '')]
  [string]$Package = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------

if (-not $env:NPM_TOKEN) {
  Write-Error @"
NPM_TOKEN is not set. Set it before running:

  `$env:NPM_TOKEN = "npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

Get a token at: https://www.npmjs.com -> Account -> Access Tokens -> Generate New Token (Automation)
"@
  exit 1
}

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

Write-Host "`n==> Building all packages..." -ForegroundColor Cyan
pnpm build
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed"; exit 1 }

# ---------------------------------------------------------------------------
# Publish helper
# ---------------------------------------------------------------------------

function Publish-Package {
  param([string]$name, [string]$dir)

  Write-Host "`n==> Publishing $name from $dir..." -ForegroundColor Cyan
  Push-Location "$repoRoot/$dir"

  $pnpmArgs = @('publish', '--access', 'public', '--no-git-checks')
  if ($DryRun) { $pnpmArgs += '--dry-run' }

  pnpm @pnpmArgs

  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Error "Publish failed for $name"
    exit 1
  }

  Pop-Location
  Write-Host "  => $name published OK" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Publish in dependency order: client → server → mcp
# (mcp depends on client — client must be on npm before mcp is published)
# ---------------------------------------------------------------------------

$dryLabel = if ($DryRun) { ' (DRY RUN)' } else { '' }
Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "  x402-zetrix-js publish$dryLabel" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow

switch ($Package) {
  'client' { Publish-Package 'x402-zetrix-client' 'packages/client' }
  'server' { Publish-Package 'x402-zetrix-server' 'packages/server' }
  'mcp'    { Publish-Package 'x402-zetrix-mcp'    'packages/mcp' }
  default  {
    Publish-Package 'x402-zetrix-client' 'packages/client'
    Publish-Package 'x402-zetrix-server' 'packages/server'
    Publish-Package 'x402-zetrix-mcp'    'packages/mcp'
  }
}

Write-Host "`n==> Done$dryLabel" -ForegroundColor Green
