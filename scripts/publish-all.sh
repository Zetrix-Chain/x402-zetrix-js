#!/usr/bin/env bash
# publish-all.sh — Build and publish all three npm packages to registry.npmjs.org
#
# Usage:
#   export NPM_TOKEN="npm_xxxxxxxx..."
#   bash scripts/publish-all.sh
#
# Optional:
#   bash scripts/publish-all.sh --dry-run          # simulate without uploading
#   bash scripts/publish-all.sh --package client   # client | server | mcp only

set -euo pipefail

DRY_RUN=0
PACKAGE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)   DRY_RUN=1 ; shift ;;
    --package)   PACKAGE="$2" ; shift 2 ;;
    *) echo "Unknown flag: $1" ; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo ""
  echo "ERROR: NPM_TOKEN is not set. Set it before running:"
  echo "  export NPM_TOKEN=\"npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\""
  echo ""
  echo "Get a token at: https://www.npmjs.com -> Account -> Access Tokens"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

echo ""
echo "==> Building all packages..."
pnpm build

# ---------------------------------------------------------------------------
# Publish helper
# ---------------------------------------------------------------------------

publish_pkg() {
  local name="$1"
  local dir="$2"
  echo ""
  echo "==> Publishing $name..."
  pushd "$REPO_ROOT/$dir" > /dev/null

  ARGS=(publish --access public --no-git-checks)
  [[ $DRY_RUN -eq 1 ]] && ARGS+=(--dry-run)

  pnpm "${ARGS[@]}"
  echo "  => $name OK"
  popd > /dev/null
}

# ---------------------------------------------------------------------------
# Publish order: client → server → mcp
# ---------------------------------------------------------------------------

DRY_LABEL=$([[ $DRY_RUN -eq 1 ]] && echo " (DRY RUN)" || echo "")
echo ""
echo "========================================"
echo "  x402-zetrix-js publish${DRY_LABEL}"
echo "========================================"

case "$PACKAGE" in
  client) publish_pkg 'x402-zetrix-client' 'packages/client' ;;
  server) publish_pkg 'x402-zetrix-server' 'packages/server' ;;
  mcp)    publish_pkg 'x402-zetrix-mcp'    'packages/mcp' ;;
  "")
    publish_pkg 'x402-zetrix-client' 'packages/client'
    publish_pkg 'x402-zetrix-server' 'packages/server'
    publish_pkg 'x402-zetrix-mcp'    'packages/mcp'
    ;;
  *) echo "Unknown package: $PACKAGE (use client | server | mcp)" ; exit 1 ;;
esac

echo ""
echo "==> Done${DRY_LABEL}"
