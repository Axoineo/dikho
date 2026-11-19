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

# Public, and needed so the Gmail sign-in can return to the app. Only the public
# fingerprint goes in it. Written for you to review and commit.
links="$(cd "$(dirname "$0")/../.." && pwd)/public/.well-known/assetlinks.json"
mkdir -p "$(dirname "$links")"
cat > "$links" <<LINKS
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "in.dikho.crm",
    "sha256_cert_fingerprints": ["$fingerprint"]
  }
}]
LINKS

cat <<DONE

Production key created in $DIR

Do this now, before building anything with it. Lose this key and no installed copy
can ever be updated again.

  1. Make an encrypted backup. It asks you to choose a passphrase. Save that in a
     password manager:

       tar -C "$(dirname "$DIR")" -czf - release | gpg --symmetric --cipher-algo AES256 -o dikho-android-key-backup.gpg

  2. Put dikho-android-key-backup.gpg in two separate places that are not this
     machine, for example a USB drive and your Google Drive. Encrypted, it is safe in
     cloud storage. Without the passphrase it is useless, so keep the two apart.

  3. Build with: export DIKHO_KEY_PROPERTIES=$DIR/key.properties

Never put release.keystore or key.properties themselves in Git, chat or email.

This certificate fingerprint is public, not a secret. It has been written to
public/.well-known/assetlinks.json, for you to commit with the release:

  $fingerprint
DONE
