#!/usr/bin/env bash
# High-signal secret scanner used by both the pre-commit hook and CI.
#
#   scripts/security/scan-secrets.sh [path ...]
#
# With no arguments it scans `src` and `dist` (source + the built browser
# bundle — the two places a leaked key would end up). The pre-commit hook
# passes the list of staged files instead.
#
# Patterns are anchored to token boundaries so they do NOT fire on the large
# base64 blobs (embedded fonts / PDF templates) that legitimately live in the
# built bundle. Exits non-zero on the first category with a match.
set -euo pipefail

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=("src" "dist")

# Keep only paths that exist, and never scan the scanner or its allowlist
# config (their literal pattern strings would self-match).
existing=()
for t in "${targets[@]}"; do
  [ -e "$t" ] || continue
  case "$t" in
    */scan-secrets.sh|scan-secrets.sh|*.gitleaks.toml|.gitleaks.toml) continue ;;
  esac
  existing+=("$t")
done
[ ${#existing[@]} -eq 0 ] && { echo "✓ secret scan: nothing to scan"; exit 0; }

# label => regex
patterns=(
  "Supabase/JWT key (eyJ.eyJ.):eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
  "Supabase secret key (sb_secret_):sb_secret_[A-Za-z0-9]{20,}"
  "Meta/WhatsApp Graph token (EAA...):[^A-Za-z0-9+/]EAA[A-Za-z0-9]{80,}"
  "OpenAI key (sk-):sk-(proj-)?[A-Za-z0-9]{20,}"
  "AWS access key id (AKIA):AKIA[0-9A-Z]{16}"
  "Google API key (AIza):AIza[0-9A-Za-z_-]{35}"
  "GitHub token (gh*_):gh[pousr]_[A-Za-z0-9]{36,}"
  "Slack token (xox*):xox[baprs]-[A-Za-z0-9-]{10,}"
  "PEM private key block:-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----"
)

found=0
for entry in "${patterns[@]}"; do
  label="${entry%%:*}"
  regex="${entry#*:}"
  if matches=$(grep -rIEnH --binary-files=without-match \
        --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.wrangler \
        --exclude='scan-secrets.sh' --exclude='.gitleaks.toml' \
        -e "$regex" "${existing[@]}" 2>/dev/null); then
    echo "✖ Potential secret — ${label}:" >&2
    echo "$matches" | sed -E 's/(.{160}).*/\1…/' >&2
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo "" >&2
  echo "✖ Secret scan failed. Credentials belong in Worker secrets / a gitignored" >&2
  echo "  .env file — never in tracked source or the built bundle." >&2
  echo "  If this is a false positive, allowlist it in .gitleaks.toml or refine the pattern." >&2
  exit 1
fi

echo "✓ secret scan clean (${existing[*]})"
