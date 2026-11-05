# Dikho CRM for Android

Last updated: 2026-11-04

A thin Flutter app around the web CRM, distributed as a signed APK with its own
update service. The decision and alternatives are in
[ADR 0011](decisions/0011-android-app.md).

The app holds no business logic and no data of its own. It loads
`https://manage.dikho.in`, so sign-in, permissions, RLS and every screen are the
ones the browser uses. Web releases reach it on the next load, with no APK.

| Path | What it is |
| --- | --- |
| `dikho-mobile/` | The Flutter project. App ID `in.dikho.crm`. |
| `dikho-mobile/lib/features/crm_webview/` | The WebView screen and the navigation allowlist |
| `dikho-mobile/lib/features/updater/` | Update check, download, verification and dialogs |
| `dikho-mobile/android/app/src/main/kotlin/` | Native layer: files, installer, origin-pinned bridge |
| `dikho-mobile/android/app/src/main/res/raw/page_bridge.js` | The only script injected into the page |
| `dikho-mobile/tool/` | Toolchain setup, key creation, release build, local tests |
| `cloudflare-updater/` | The update API Worker and APK hosting. See its [README](../cloudflare-updater/README.md). |

## Set up a development machine

```bash
dikho-mobile/tool/setup-toolchain.sh --emulator
```

```bash
source ~/.local/share/dikho-android/env.sh
```

This installs pinned versions of Flutter, Temurin JDK 17 and the Android SDK under
`~/.local/share/dikho-android`, checking each download's checksum. Nothing is
installed system-wide. Running it accepts the Android SDK license. Allow about
15 GB of disk, and 8 GB of RAM if you also run an emulator.

Everyday commands, from `dikho-mobile/`:

```bash
flutter analyze
```

```bash
flutter test
```

Running the app needs a signing key and a local backend, or a phone. See
[Testing](#testing).

## The signing key

Android identifies an app by its application ID and its signing certificate. **A
copy of the app signed with one key can only ever be updated by the same key.**

There is no recovery. If the production key is lost:

- nobody can update their installed app;
- everyone must uninstall, which deletes their local sign-in, and install a new app
  under a new key;
- under Android developer verification you could not register the package either.
  Google's FAQ: "If you lose your signing key you won't be able to register your
  packages."

If it leaks, anyone can sign an APK that Android accepts as an update, subject to
reaching the phone. Treat it like the keys to the company's bank account.

### Create the production key

No production key exists yet. Every APK built so far uses a throwaway test key, and
those builds must not go to staff. Do this once, yourself:

```bash
dikho-mobile/tool/create-release-key.sh
```

It generates a 4096-bit RSA key with a random password in
`~/.config/dikho-android/release/`, readable only by you, and prints the public
fingerprint. It refuses to overwrite an existing key. Then:

1. Back up `release.keystore` and `key.properties` to **two separate encrypted
   locations that are not this machine**, for example two encrypted USB drives kept
   in different places.
2. Record who holds them and test restoring one. A backup you have never restored
   is a hope, not a backup.
3. Never put either file in Git, chat, email or a cloud folder without encryption.
   `*.keystore`, `*.jks` and `key.properties` are ignored by Git. This repository
   is public, so a mistake here cannot be recalled.

## Build a release

```bash
export DIKHO_KEY_PROPERTIES=$HOME/.config/dikho-android/release/key.properties
```

```bash
dikho-mobile/tool/build-release.sh
```

The script prints the APK path, size, SHA-256 and signer. It builds for `arm` and
`arm64`, which covers real phones. With no key configured Gradle fails on purpose,
and it never falls back to a debug key.

Before each release, raise `version` in `dikho-mobile/pubspec.yaml`. The number
after the `+` is the version code, which must go up every time, for example
`1.1.0+2`.

| Build | Size |
| --- | --- |
| Release, `arm` + `arm64` | 15,082,355 bytes (14.4 MiB) |
| With `x86_64` added | about 22.8 MB (21.7 MiB) |
| Cloudflare Static Assets limit, per file | 26,214,400 bytes (25 MiB) |

## Publish

Three things are needed the first time, all with the owner's approval.

**1. Deploy the update service once.** It starts with nothing published:

```bash
npx wrangler deploy -c cloudflare-updater/wrangler.jsonc
```

Check it from any machine. This should answer `{"updateAvailable":false}`:

```bash
curl "https://dikho-updates.fineeurox.workers.dev/api/update?appId=in.dikho.crm&versionCode=1"
```

**2. Choose the update address before the first real build.** The default needs no
DNS change. See "Where the service lives" in the
[updater README](../cloudflare-updater/README.md).

**3. Allow the Gmail return.** Connecting a Gmail mailbox runs in the browser, and
Google's redirect comes back to the app through an Android App Link. That needs a
public file on the CRM's origin, which currently returns the SPA's HTML. Create
`public/.well-known/assetlinks.json` using the fingerprint from the key script:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "in.dikho.crm",
    "sha256_cert_fingerprints": ["AA:BB:CC:..."]
  }
}]
```

It ships with a normal push to `main`. Without it the app works, except that on
Android 12 and later a Gmail connection finishes in the browser instead of the app,
where the person has to sign in again. Google OAuth itself is not configured in
production yet either (`docs/runbooks/email-hub-rollout.md`), so this is only urgent
once it is.

### Each new version

```bash
source ~/.local/share/dikho-android/env.sh
```

```bash
export DIKHO_KEY_PROPERTIES=$HOME/.config/dikho-android/release/key.properties
```

```bash
dikho-mobile/tool/build-release.sh
```

```bash
node cloudflare-updater/scripts/add-release.mjs --apk dikho-mobile/build/app/outputs/flutter-apk/app-release.apk --notes "What changed, in plain words."
```

```bash
git diff cloudflare-updater/releases/manifest.json
```

```bash
npx wrangler deploy -c cloudflare-updater/wrangler.jsonc
```

Then confirm the service answers with the new version, install it on a phone from
the previous version, and keep the APK file with your release records. Keep
`cloudflare-updater/public/releases/` intact between deploys: a deploy replaces the
whole file set.

To force everyone below a version to update, pass `--min-supported <version code>`.
Use it for real incompatibilities only.

### First install for staff

Send people the stable link, `https://dikho-updates.fineeurox.workers.dev/download`.
Android will ask them to allow their browser to install apps, and may warn that the
source is unknown. That is expected for an app outside Play. Tell them in advance,
and tell them the link, so a lookalike stands out.

On phones with Google Play, **Play Protect may then say "App scan recommended"** and
offer "Scan app" or "Don't install app". This was seen on a self-update on a
Play-certified Android 16 image with a test build, and the first install from a browser
should be expected to do the same, though that was not tried. The right answer is
"Scan app", then "Install" once it says the app looks safe. It sends the APK to Google,
and the APK contains no secrets. Tell staff to expect it, because "Don't install app"
looks like the safe choice, and choosing it cancels the update.

## Updates: what to expect

- **Web changes need no APK.** Fresh app starts always load the current CRM. A
  process kept alive for 8 hours or more reloads when reopened, unless a dialog is
  open or someone is typing.
- **The app checks at most every 6 hours**, after the CRM has loaded and on return
  to the foreground. A failed check is silent and retried at the next launch.
- **Later** holds for that version for 24 hours.
- **Android always asks for confirmation.** The first update also asks the person to
  allow Dikho CRM to install apps, and Play Protect may offer a scan. There is no silent
  install on ordinary phones. Android then closes the app and leaves the person on the
  home screen, so they reopen it themselves.
- **Sign-in survives an update.** Local storage lives in the app's private data,
  which Android keeps across an upgrade.

## Android developer verification

Google is requiring apps on certified Android devices to come from verified
developers, including apps installed outside Play. As read on 2026-11-04:

- Enforcement began on 30 September 2026 only for participating stores in Brazil,
  Indonesia, Singapore and Thailand. Google's FAQ says that if "users sideload your
  app directly, these new verification requirements won't apply to your app yet."
- It expands "globally to all apps on certified Android devices" in 2027. Google has
  named no India date.
- After that, the FAQ says unregistered apps can only be installed or updated with
  the "advanced flow" enabled or by ADB. **Self-updates would fail without
  registration.** The advanced flow is a one-time setup per phone, with developer
  options and a 24-hour wait. That is not reasonable to ask of staff.
- Organizations register through the Android Developer Console with a D-U-N-S number
  (free, up to 28 days to obtain) and a $25 fee. The application ID and signing key
  are registered there, which is another reason to create the production key before
  claiming the package.
- Limited distribution accounts allow 20 devices at no cost, but are aimed at
  students and hobbyists. Apps on managed devices through an organization's store are
  exempt, if Dikho ever adopts device management.

**Action for the owner, well before 2027:** get a D-U-N-S number, then register
`in.dikho.crm` with the production key.

Sources: [overview](https://developer.android.com/developer-verification),
[FAQ](https://developer.android.com/developer-verification/guides/faq),
[Console help](https://support.google.com/android-developer-console/answer/16561738).
These dates have moved before, so check again before relying on them.

## Google Play later

Nothing here blocks a Play listing: same app ID, same key if you opt out of Play App
Signing, or enrol it. Three changes would be needed: remove
`REQUEST_INSTALL_PACKAGES` and the updater, because Play restricts both, build an
AAB with `flutter build appbundle`, and complete Play's data safety form.

## Automating releases later

The manual steps above map directly onto a pipeline: tests, signed build, checksum,
`add-release.mjs`, `wrangler deploy`. Store the keystore (base64) and passwords as
repository secrets, and require a manual approval on the job. The repository being
public makes this riskier, not safer: a workflow that can read those secrets must
never run on pull requests from forks. Not built yet, by design.

## Testing

### What runs without a device

```bash
flutter test
```

```bash
node --test cloudflare-updater/test/*.test.js
```

### On an emulator, against a fake backend

`dikho-mobile/tool/local-test/` runs the real CRM build against a stand-in for
Supabase and the API, and a test APK that talks only to `localhost`. Nothing reaches
production, no OTP is sent and all records are synthetic. The code is always
`123456`.

```bash
dikho-mobile/tool/local-test/build-spa.sh /tmp/dist-local
```

```bash
node dikho-mobile/tool/local-test/server.mjs --spa /tmp/dist-local --updates /tmp/updates
```

```bash
dikho-mobile/tool/create-test-key.sh
```

```bash
dikho-mobile/tool/local-test/build-apk.sh 1.0.0 1 /tmp/v1.0.0.apk --target-platform android-x64
```

```bash
emulator -avd <name> -no-window -no-audio -no-boot-anim -gpu host
```

```bash
adb install -r /tmp/v1.0.0.apk
```

```bash
node dikho-mobile/tool/local-test/device-test.mjs web
```

Scenarios are `web`, `files`, `layout`, `upgrade`, `reinstall`, `save-dialog`,
`tls` and `no-debug`. `upgrade` also takes `--updates`, `--old-apk`, `--new-apk`
and `--other-signer-apk`, and `reinstall` takes `--old-apk`. `save-dialog` needs a
build with `--dart-define=FORCE_SAVE_DIALOG=true`, and `tls` one with
`--dart-define=UPDATE_BASE_URL=https://<real host>`.

Use `-gpu host` if the machine has a GPU. The emulator itself crashed repeatedly on
this project's test machine (a `RenderThread` segfault in `qemu`, with "invalid color
buffer" in its log). The software renderers did so within minutes and `host` only
rarely, so restart it and repeat the scenario if `adb` loses the device. Uninstall
first when going down a version: `adb install -r` refuses a lower version code.

Test builds are marked by `LOCAL_TEST_BUILD`, permit plain http to `localhost` and
have WebView debugging on. `tool/build-release.sh` cannot produce one, and a normal
build refuses a non-https origin at startup.

### Results

Last run 2026-11-05, on the final code, with the APKs signed by the test key.

| Check | Result |
| --- | --- |
| `dart format`, `flutter analyze` | clean |
| `flutter test` | 68 passed |
| `node --test cloudflare-updater/test/*.test.js` | 14 passed |
| Update Worker under `wrangler dev` (real Workers runtime) | API answers, APK headers, checksum and `/download` checked by hand with `curl` |
| `add-release.mjs` guards | same version, other signer and empty notes all refused |

Device runs, on emulators against the fake backend:

| Scenario | Android 16 | Android 15 | Android 14 |
| --- | --- | --- | --- |
| OS image | user build, Google Play | userdebug | userdebug |
| WebView | 133 | 124 | 113 |
| `web`: sign-in, session, navigation, back, keyboard, rotation, dark mode, offline, server errors, Gmail return link, sign-out, a real tax invoice | 22 of 22 | 22 of 22 | 22 of 22 |
| `files`: downloads, uploads, dialogs, clipboard, external links, refused schemes, bridge isolation | 27 of 27, 1 not run | 28 of 28 | 28 of 28 |
| `layout`: no sideways overflow on 15 routes | 15 of 15 | 15 of 15 | 15 of 15 |
| `upgrade`: signed 1.0.0 to 1.1.0 through the app, with checksum, wrong signer, permission and cancel cases | 12 of 12 | 12 of 12 | 12 of 12 |
| `reinstall`: saving a name left by an earlier install | not run | 2 of 2 | 2 of 2 |
| `save-dialog`: the Android 7 to 9 save path, forced on | not run | 2 of 2 | 2 of 2 |
| `tls`: update client completing TLS to `manage.dikho.in` | passed | passed | passed |
| `no-debug`: production-config build, against the live sign-in page | passed, no debug socket | app not debuggable, socket not checkable | app not debuggable, socket not checkable |

The one `files` check not run on Android 16 changes the device clock, which needs root.
`reinstall` needs root as well, and `save-dialog` was simply not repeated there. The
debug socket can only be judged on a user build: a `userdebug` Android turns WebView
debugging on for every app, whatever the app does.

The upgrade on Android 16 went through Play Protect's prompts ("App scan recommended",
"Scan app", "This app looks safe", "Install"). The other two images have no Play Protect.

**Not run, and needed before staff rely on this:**

- A real phone. Every result above is from an emulator, so real-device speed, memory
  use and a low-end phone are all unmeasured.
- A real sign-in. No real OTP was sent and no production data was read. Production was
  only loaded as far as its public sign-in page, and fetched by the TLS check.
- The deployed update Worker, because it is not deployed. Updates were served by the
  same handler code on `localhost`.
- An APK signed with the production key, because the key does not exist yet.
- The Gmail return through a verified App Link. The return page was opened with an
  explicit Android intent and finished correctly, but verification needs
  `assetlinks.json`, and Google OAuth is not configured in production yet.
- Turnstile on the public forms inside the app.
- Android 7 to 13. Android 14's stock image already ships WebView 113, just above the
  minimum of 111, so older images are expected to fall below it and would only show the
  "update WebView" screen. That screen is covered by a unit test, not a device run.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Build fails with "No release signing key" | `DIKHO_KEY_PROPERTIES` is not set or points nowhere. Correct by design. |
| "Update Android System WebView" screen | The phone's WebView is below version 111. Update it from Play. Phones without Play cannot run the CRM. |
| Update dialog never appears | Checked within the last 6 hours, or snoozed. Check the API with `curl`. Reinstalling or clearing app data resets the schedule. |
| "This update was rejected" | The APK's signer differs from the installed app. Check you built with the production key. Nothing was installed. |
| "The download was damaged" | Size or SHA-256 mismatch against the manifest. Rebuild the manifest with `add-release.mjs` and redeploy. |
| Android says "App not installed" | Usually a lower version code or a different signer than what is installed. |
| A file will not open | No viewer for that type on the phone. The message offers Share instead. |
| `add-release.mjs` refuses the APK | The message names why: not newer, wrong app ID, different certificate or too large. |
| Gmail connect ends in the browser | `assetlinks.json` is missing or has the wrong fingerprint. Check with `adb shell pm get-app-links in.dikho.crm`. |
| Emulator shows "System UI isn't responding", or `qemu` exits | Software rendering on a busy machine, not the app. Use `-gpu host` and let it settle after booting. |
| Build runs out of memory | `dikho-mobile/android/gradle.properties` gives Gradle 3 GB. Stop any emulator while building. |

## Security and limitations

What protects the app:

- HTTPS only, enforced in the network security config, the manifest and at startup.
  Only system certificate authorities are trusted, and TLS errors are never bypassed.
- The WebView stays on the exact CRM origin. `intent:`, `file:`, `content:`,
  `javascript:` and everything else not listed are refused.
- The page reaches native code only through a channel Android pins to the CRM origin,
  in the main frame. It can hand over a file, copy text and report colours, nothing
  else.
- Requests for camera, microphone and location are denied. The manifest has none of
  those permissions.
- Backups are off, so the session cannot leave the device through cloud backup or
  device transfer. WebView debugging is off in release builds, and page console output
  is not copied to the system log.
- An APK arriving from a page or email can be saved but is never opened from here,
  because this app holds the install permission.
- The update check sends only the app ID, version code, channel and platform.
- Signed and ticketed links are fetched with no cookie or token.

What it does not change: authorization is still RLS and the API. Rooted phones and
malware with device-level access are out of scope. The open findings in
`docs/SECURITY-AUDIT.md` apply equally here.

Known limitations:

- **Saved files are outside the app.** Downloads go to the shared Downloads folder at
  the person's request, where other apps with storage access can read them.
- **Screenshots and the recent-apps preview are allowed**, because staff share them for
  work. To forbid them, add `FLAG_SECURE` in `MainActivity`. It would also block screen
  sharing.
- **Voice notes are not available in the app.** The app denies microphone requests and
  declares no `RECORD_AUDIO`. Production also sends `Permissions-Policy: microphone=()`,
  which should block recording in every browser too, though that was read from the header
  and not tried. Turning it on takes a web header change plus `RECORD_AUDIO` here.
- **No offline use.** The app shows a failure screen and retries. Nothing is cached for
  offline reading, and no change is queued.
- **No push notifications.** The CRM has none to deliver.
- **A sign-in can be lost if the app is killed within seconds of it.** WebView writes
  `localStorage` to disk a few seconds after the page does, and offers no way to force
  it. A force-stop in that window means signing in again, nothing worse.
- **A WebView renderer crash restarts the app.** `webview_flutter` does not expose a
  way to recover in place. The session survives.
- **Android 7 to 9 are lightly covered.** They need WebView 111 or later, which their
  emulator images do not ship. Their save-dialog path was run on a newer Android
  through a test flag instead.
