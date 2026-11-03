#!/usr/bin/env bash
# Vendors @supabase/supabase-js as a self-contained browser ESM bundle.
# Uses esbuild via npx. node_modules is transient (/tmp), not committed.
set -euo pipefail

PINNED_VERSION="2.45.4"
ESBUILD_VERSION="0.24.0"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE="${DIR}/supabase.min.js"
LICENSE="${DIR}/SUPABASE_LICENSE.txt"
HASH_FILE="${DIR}/SUPABASE_BUNDLE_SHA256.txt"

for t in node npm npx sha256sum; do
  command -v "$t" >/dev/null 2>&1 || { echo "ERROR: $t required" >&2; exit 1; }
done

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Installing @supabase/supabase-js@${PINNED_VERSION} in temp dir..."
( cd "$WORKDIR" \
  && npm init -y >/dev/null 2>&1 \
  && npm install --no-audit --no-fund "@supabase/supabase-js@${PINNED_VERSION}" >/dev/null )

echo "Bundling with esbuild@${ESBUILD_VERSION}..."
npx --yes "esbuild@${ESBUILD_VERSION}" \
  --bundle \
  --platform=browser \
  --format=esm \
  --target=es2020 \
  --minify \
  --define:process.env.NODE_ENV='"production"' \
  --outfile="$BUNDLE" \
  "$WORKDIR/node_modules/@supabase/supabase-js/dist/module/index.js"

SIZE=$(wc -c < "$BUNDLE")
[[ "$SIZE" -ge 100000 ]] || { echo "ERROR: bundle too small ($SIZE bytes)" >&2; exit 1; }
grep -q 'createClient' "$BUNDLE" || { echo "ERROR: no createClient in bundle" >&2; exit 1; }
if grep -qE "\\bfrom[[:space:]]*['\"]https?://" "$BUNDLE" \
   || grep -qE "\\bimport\\([[:space:]]*['\"]https?://" "$BUNDLE"; then
  echo "ERROR: bundle still references external URLs" >&2
  exit 1
fi

sha256sum "$BUNDLE" | awk '{print $1}' > "$HASH_FILE"

if [[ -f "$WORKDIR/node_modules/@supabase/supabase-js/LICENSE" ]]; then
  cp "$WORKDIR/node_modules/@supabase/supabase-js/LICENSE" "$LICENSE"
fi

echo ""
echo "Vendored @supabase/supabase-js@${PINNED_VERSION}."
echo "  $BUNDLE  ($SIZE bytes)"
echo "  SHA-256: $(cat "$HASH_FILE")"
echo "  $LICENSE"
