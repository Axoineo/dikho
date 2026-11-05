#!/usr/bin/env bash
# Installs the exact Flutter, JDK and Android SDK versions this app is built
# with, under one user-owned directory. Nothing is installed system-wide and no
# shell profile is changed. Remove the directory to uninstall.
#
#   dikho-mobile/tool/setup-toolchain.sh            build tools only
#   dikho-mobile/tool/setup-toolchain.sh --emulator also an x86_64 emulator
#
# Running this accepts the Android SDK license terms. Read them with
# `sdkmanager --licenses` first if you have not already.
set -euo pipefail

ROOT="${DIKHO_ANDROID_HOME:-$HOME/.local/share/dikho-android}"

FLUTTER_VERSION=3.47.9
FLUTTER_SHA256=25ed8c3c29d51a7353f2a944310b478af8214920639524b19c50a19e6c044c5a
FLUTTER_URL="https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"

JDK_DIR=jdk-17.0.21+9
JDK_SHA256=8b9b611d917e3dfd8419d3566b5949226f69b052fed7e109c1368add1dfe8711
JDK_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_x64_linux_hotspot_17.0.21_9.tar.gz"

CMDLINE_SHA1=e025545c62a8e64c7559119566a569fb1dec5f60
CMDLINE_URL="https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip"

SDK_PACKAGES=("platform-tools" "platforms;android-36" "build-tools;36.0.0")
EMULATOR_PACKAGES=("emulator" "system-images;android-35;google_apis;x86_64")

want_emulator=false
[ "${1:-}" = "--emulator" ] && want_emulator=true

mkdir -p "$ROOT/downloads"

fetch() { # url file checksum-tool checksum
  local url=$1 file="$ROOT/downloads/$2" tool=$3 sum=$4
  if [ ! -f "$file" ] || ! echo "$sum  $file" | "$tool" --check --status; then
    echo "Downloading $2"
    curl --fail --location --retry 3 --continue-at - --output "$file" "$url" || \
      curl --fail --location --retry 3 --output "$file" "$url"
  fi
  echo "$sum  $file" | "$tool" --check --status || { echo "Checksum mismatch for $2" >&2; exit 1; }
}

fetch "$JDK_URL" jdk.tar.gz sha256sum "$JDK_SHA256"
if [ ! -x "$ROOT/$JDK_DIR/bin/java" ]; then
  tar -xzf "$ROOT/downloads/jdk.tar.gz" -C "$ROOT"
fi
export JAVA_HOME="$ROOT/$JDK_DIR"

fetch "$CMDLINE_URL" cmdline-tools.zip sha1sum "$CMDLINE_SHA1"
export ANDROID_HOME="$ROOT/android-sdk"
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest" "$ANDROID_HOME/cmdline-tools/cmdline-tools"
  unzip -q "$ROOT/downloads/cmdline-tools.zip" -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$sdkmanager" --licenses >/dev/null || true
"$sdkmanager" --install "${SDK_PACKAGES[@]}" >/dev/null
if $want_emulator; then
  "$sdkmanager" --install "${EMULATOR_PACKAGES[@]}" >/dev/null
fi

fetch "$FLUTTER_URL" flutter.tar.xz sha256sum "$FLUTTER_SHA256"
if [ ! -x "$ROOT/flutter/bin/flutter" ]; then
  tar -xJf "$ROOT/downloads/flutter.tar.xz" -C "$ROOT"
fi
export PATH="$ROOT/flutter/bin:$PATH"
git config --global --add safe.directory "$ROOT/flutter" 2>/dev/null || true
flutter --disable-analytics >/dev/null 2>&1 || true
flutter config --no-analytics --android-sdk "$ANDROID_HOME" --jdk-dir "$JAVA_HOME" >/dev/null

cat > "$ROOT/env.sh" <<ENV
export JAVA_HOME="$JAVA_HOME"
export ANDROID_HOME="$ANDROID_HOME"
export PATH="$ROOT/flutter/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:\$PATH"
ENV

flutter --version
echo "Toolchain ready. Load it with: source $ROOT/env.sh"
