#!/usr/bin/env bash
# Builds an APK that talks only to tool/local-test/server.mjs on localhost,
# signed with the test key. Never distribute one: it permits plain http to
# localhost and has WebView debugging on.
#
#   dikho-mobile/tool/local-test/build-apk.sh <version> <code> <output file> [extra flutter args]
set -euo pipefail

version=$1 code=$2 output=$3
shift 3

cd "$(dirname "$0")/../.."
ENV_FILE="${DIKHO_ANDROID_HOME:-$HOME/.local/share/dikho-android}/env.sh"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

export DIKHO_KEY_PROPERTIES="${DIKHO_KEY_PROPERTIES:-${DIKHO_KEY_HOME:-$HOME/.config/dikho-android}/test/key.properties}"
flutter build apk --release \
  --build-name="$version" --build-number="$code" \
  --android-project-arg=dikhoLocalTest=true \
  --dart-define=LOCAL_TEST_BUILD=true \
  --dart-define=CRM_ORIGIN=http://localhost:5199 \
  --dart-define=API_ORIGIN=http://localhost:54321 \
  --dart-define=UPDATE_BASE_URL=http://localhost:8799 \
  "$@"
cp build/app/outputs/flutter-apk/app-release.apk "$output"
echo "$output: $(stat -c %s "$output") bytes"
