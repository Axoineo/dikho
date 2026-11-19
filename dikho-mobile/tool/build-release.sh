#!/usr/bin/env bash
# Builds the signed release. Refuses anything that could turn a test build into
# something people install: it takes no origins from the environment, and Gradle
# fails outright with no signing key rather than falling back to a debug key.
#
#   dikho-mobile/tool/build-release.sh [--update-base-url https://host]    the APK we distribute
#   dikho-mobile/tool/build-release.sh --play [--update-base-url ...]      the bundle for Google Play
#
# Dart class and method names are obfuscated. The symbols needed to read a crash
# report are copied to $DIKHO_KEY_HOME/symbols/<version>: keep them for as long as that
# release is installed anywhere. They are not secret, but they do not belong in Git.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${DIKHO_ANDROID_HOME:-$HOME/.local/share/dikho-android}/env.sh"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

play=false
update_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --play) play=true; shift ;;
    --update-base-url)
      case "${2:-}" in
        https://*) update_args=(--dart-define="UPDATE_BASE_URL=$2"); shift 2 ;;
        *) echo "--update-base-url must be an https address" >&2; exit 1 ;;
      esac ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [ -z "${DIKHO_KEY_PROPERTIES:-}" ]; then
  echo "DIKHO_KEY_PROPERTIES is not set. See docs/ANDROID.md." >&2
  exit 1
fi

# The Supabase project the app signs in to, and its publishable key: public values
# (every browser that opens the CRM has them), kept out of Git because the repository
# is public. Taken from DIKHO_SUPABASE_URL and DIKHO_SUPABASE_PUBLISHABLE_KEY, or else
# from the web's own .env.local, the file the CRM itself is built with. Never printed.
web_env="$(cd .. && pwd)/.env.local"
from_web() { [ -f "$web_env" ] && sed -n "s/^$1=//p" "$web_env" | tail -1 | tr -d '\r"' || true; }
supabase_url="${DIKHO_SUPABASE_URL:-$(from_web VITE_SUPABASE_URL)}"
supabase_key="${DIKHO_SUPABASE_PUBLISHABLE_KEY:-$(from_web VITE_SUPABASE_PUBLISHABLE_KEY)}"
case "$supabase_url" in
  https://*) ;;
  *) echo "No https Supabase address: set DIKHO_SUPABASE_URL or VITE_SUPABASE_URL in .env.local." >&2; exit 1 ;;
esac
if [ -z "$supabase_key" ]; then
  echo "No Supabase publishable key: set DIKHO_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_PUBLISHABLE_KEY in .env.local." >&2
  exit 1
fi
supabase_args=(--dart-define="SUPABASE_URL=$supabase_url" --dart-define="SUPABASE_PUBLISHABLE_KEY=$supabase_key")
# The Email Hub's pages, as the web build has them.
[ "$(from_web VITE_EMAIL_HUB)" = "true" ] && supabase_args+=(--dart-define=EMAIL_HUB=true)

symbols=build/app/outputs/symbols
rm -rf "$symbols"
hardening=(--obfuscate "--split-debug-info=$symbols")

flutter pub get
if $play; then
  flutter build appbundle --release --flavor play "${hardening[@]}" "${update_args[@]}" "${supabase_args[@]}"
  output=build/app/outputs/bundle/playRelease/app-play-release.aab
else
  flutter build apk --release --flavor direct --target-platform android-arm64 "${hardening[@]}" "${update_args[@]}" "${supabase_args[@]}"
  output=build/app/outputs/flutter-apk/app-direct-release.apk
fi

version="$(sed -n 's/^version: *//p' pubspec.yaml)"
keep="${DIKHO_KEY_HOME:-$HOME/.config/dikho-android}/symbols/$version"
mkdir -p "$keep"
cp -r "$symbols/." "$keep/"

echo
echo "Output:  $PWD/$output"
echo "Bytes:   $(stat -c %s "$output")"
echo "SHA256:  $(sha256sum "$output" | cut -d' ' -f1)"
echo "Symbols: $keep"
if ! $play; then
  "$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs "$output" | grep -E 'certificate (DN|SHA-256)'
fi
