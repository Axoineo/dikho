#!/usr/bin/env bash
# Creates the permanent production signing key. Run this yourself, once. Every
# future update must be signed with this exact key: lose it and no installed
# copy can ever be updated again. See docs/ANDROID.md, "The signing key".
set -euo pipefail

DIR="${DIKHO_KEY_HOME:-$HOME/.config/dikho-android}/release"
ENV_FILE="${DIKHO_ANDROID_HOME:-$HOME/.local/share/dikho-android}/env.sh"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

if [ -e "$DIR/release.keystore" ]; then
  echo "Refusing to overwrite the existing key at $DIR/release.keystore" >&2
  exit 1
fi

umask 077
mkdir -p "$DIR"
password="$(openssl rand -hex 32)"

keytool -genkeypair -noprompt \
  -keystore "$DIR/release.keystore" -storetype PKCS12 \
  -storepass "$password" -keypass "$password" \
  -alias dikho-crm -keyalg RSA -keysize 4096 -validity 25000 \
  -dname "CN=Dikho CRM, O=Dikho Global Media LLP, L=India, C=IN"

cat > "$DIR/key.properties" <<PROPS
storeFile=$DIR/release.keystore
storePassword=$password
keyAlias=dikho-crm
keyPassword=$password
PROPS

fingerprint="$(keytool -list -v -keystore "$DIR/release.keystore" -storepass "$password" -alias dikho-crm | sed -n 's/^.*SHA256: //p')"

cat <<DONE

Production key created in $DIR

Do these before building anything with it:
  1. Copy release.keystore and key.properties to two separate encrypted backups
     that do not live on this machine. Neither file belongs in Git or a chat.
  2. Build with: export DIKHO_KEY_PROPERTIES=$DIR/key.properties

The certificate fingerprint below is public. It goes in
public/.well-known/assetlinks.json so the Gmail sign-in can return to the app:

  $fingerprint
DONE
