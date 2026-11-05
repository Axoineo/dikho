#!/usr/bin/env bash
# Creates a throwaway signing key for builds and upgrade tests. An APK signed
# with it can never update, or be updated by, a production build, so it must
# not go to staff. Kept outside the repository.
set -euo pipefail

DIR="${DIKHO_KEY_HOME:-$HOME/.config/dikho-android}/test"
ENV_FILE="${DIKHO_ANDROID_HOME:-$HOME/.local/share/dikho-android}/env.sh"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

if [ -e "$DIR/test.keystore" ]; then
  echo "A test key already exists at $DIR"
  exit 0
fi

umask 077
mkdir -p "$DIR"
password="$(openssl rand -hex 24)"

keytool -genkeypair -noprompt \
  -keystore "$DIR/test.keystore" -storetype PKCS12 \
  -storepass "$password" -keypass "$password" \
  -alias dikho-test -keyalg RSA -keysize 4096 -validity 3650 \
  -dname "CN=DIKHO TEST KEY - DO NOT DISTRIBUTE, O=Dikho Global Media LLP, C=IN"

cat > "$DIR/key.properties" <<PROPS
storeFile=$DIR/test.keystore
storePassword=$password
keyAlias=dikho-test
keyPassword=$password
PROPS

echo "Test key created in $DIR"
echo "Use it with: export DIKHO_KEY_PROPERTIES=$DIR/key.properties"
