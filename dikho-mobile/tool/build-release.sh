#!/usr/bin/env bash
# Builds the signed release APK. Refuses anything that could turn a test build
# into something people install: it takes no origins from the environment, and
# Gradle fails outright with no signing key rather than falling back to a debug
# key.
#
#   dikho-mobile/tool/build-release.sh [--update-base-url https://host]
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${DIKHO_ANDROID_HOME:-$HOME/.local/share/dikho-android}/env.sh"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

update_args=()
if [ "${1:-}" = "--update-base-url" ]; then
  case "${2:-}" in
    https://*) update_args=(--dart-define="UPDATE_BASE_URL=$2") ;;
    *) echo "--update-base-url must be an https address" >&2; exit 1 ;;
  esac
fi

if [ -z "${DIKHO_KEY_PROPERTIES:-}" ]; then
  echo "DIKHO_KEY_PROPERTIES is not set. See docs/ANDROID.md." >&2
  exit 1
fi

flutter pub get
flutter build apk --release --target-platform android-arm,android-arm64 "${update_args[@]}"

apk=build/app/outputs/flutter-apk/app-release.apk
echo
echo "APK:    $PWD/$apk"
echo "Bytes:  $(stat -c %s "$apk")"
echo "SHA256: $(sha256sum "$apk" | cut -d' ' -f1)"
"$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs "$apk" | grep -E 'certificate (DN|SHA-256)'
