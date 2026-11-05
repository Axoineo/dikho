#!/usr/bin/env bash
# Builds the CRM against the fake backend. Process variables outrank .env.local,
# so no production address ends up in this bundle.
#
#   dikho-mobile/tool/local-test/build-spa.sh <output dir>
set -euo pipefail

cd "$(dirname "$0")/../../.."
VITE_SUPABASE_URL=http://localhost:54321 \
VITE_SUPABASE_PUBLISHABLE_KEY=local-test-only \
VITE_API_BASE=http://localhost:54321 \
VITE_EMAIL_HUB=true \
npx vite build --outDir "$1" --emptyOutDir
