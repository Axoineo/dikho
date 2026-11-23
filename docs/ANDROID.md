# Dikho CRM for Android

Last updated: 2026-11-06

A Flutter app, distributed as a signed APK with its own update service. The decisions
and alternatives are in [ADR 0011](decisions/0011-android-app.md) and
[ADR 0012](decisions/0012-android-native-screens.md).

**Native:** sign-in (a code by email or WhatsApp; the app owns the session, see
[ADR 0013](decisions/0013-native-sign-in.md)), the drawer, the top bar, Clients, Leads, Sales orders, Vendors, Purchase orders, Users, Settings, Live Assist ([ADR 0014](decisions/0014-live-assist-on-phones.md)), the whole Email Hub (overview, inbox, analytics, campaigns, templates, consent and Email settings, with Google's return finished by the app), the WhatsApp inbox, dashboard,
campaigns (with a screen per campaign and the new-campaign wizard), contacts and
templates, Phone contacts and the update screens. Importing contacts from a spreadsheet
is native too: `sheet_reader.dart` and `contact_import.dart` read CSV, Excel and JSON
files exactly as `src/lib/parseSheet.js` and `src/lib/contactImport.js` do (same limits,
same column detection), off the screen's thread, and numbers are checked with
`phone_numbers_parser` (MIT, Google's numbering metadata). A test holds them to answers
the web's own functions gave in Node (`test/fixtures/contact_import_web.json`); when the
web importer changes, regenerate that file. A sales order's Tax invoice is drawn on the phone:
`lib/features/sales_orders/tax_invoice.dart` lays it out exactly as
`src/features/invoices/generateTaxInvoice.js` does, and `TaxInvoice.kt` draws that onto
the same template with the same fonts using PdfBox-Android (Apache 2.0, about 3 MB),
then it is saved to Downloads. The template and fonts in
`android/app/src/main/assets/invoice/` are copies of `public/Temps`, and a test fails
when they differ, so a template change must be copied to both. It is not made on the
API: one invoice takes about 80 ms of computing, and the Workers free plan allows about
10 ms.

**The new-campaign wizard and repeated starts.** Starting a campaign
(`POST /api/campaigns/send`) creates it and sends the first batch. On the API now live,
nothing stops the same start arriving twice, and a reply lost on a bad connection would
create a second campaign and message the first batch again: paid messages, and harm to
the number's quality rating. The native wizard (`lib/features/whatsapp/campaign_sender.dart`)
therefore sends a one-time `requestId` with the start and never repeats any request by
itself. If a start's reply is lost, it says so and offers Try again, which resends the same
`requestId`; the API in this branch answers that with the campaign it already started
(`campaigns.request_id`, D1 migration 0013). Batches (`/send-batch`) are safe to resume on
any API, because each person is claimed once per campaign.

So the APK with the wizard must ship only after D1 migration 0013 and an API with the
request-id fix are live (the deploy order already puts the APK last). `test/campaign_sender_test.dart`
shows what an older API would do with Try again: a second campaign. The web wizard on
`main` still retries a failed start three times without the id; the fix in this branch
adds the id there too. **In a WebView:** every other module, from `https://manage.dikho.in`, so its
permissions, RLS and screens are the ones the browser uses, and web releases reach it on
the next load with no APK. A module moves across by giving its drawer entry a native
screen.

The page stays loaded behind the native screens. The app owns the session
([ADR 0013](decisions/0013-native-sign-in.md)): native screens use its current access
token and call the same API and database functions a browser does, and the page reads
the same session through the vault. When native Settings saves a change, the app asks
the page to load the person's access and the organization's settings again
(`window.__dikhoShell.settingsChanged()`), so the page shows the same theme, lists and
formats. Hiding a drawer entry is navigation, not security: the API and RLS check
permissions on every request.

| Path | What it is |
| --- | --- |
| `dikho-mobile/` | The Flutter project. App ID `in.dikho.crm`. |
| `dikho-mobile/lib/features/crm_webview/` | The main screen, the WebView and the navigation allowlist |
| `dikho-mobile/lib/features/shell/` | The drawer, what the page tells the app, the session vault |
| `dikho-mobile/lib/features/inbox/` | The native WhatsApp inbox |
| `dikho-mobile/lib/features/clients/` | Clients: list, search, details, add and edit, call, email, new sales order |
| `dikho-mobile/lib/features/leads/` | Leads: list, search, details, call, WhatsApp, email |
| `dikho-mobile/lib/features/vendors/` | Vendors: list, search and filters, details, document, add and edit, New PO |
| `dikho-mobile/lib/features/sales_orders/`, `purchase_orders/` | Sales and purchase orders: lists, details, forms with GST worked out, the shared order parts |
| `dikho-mobile/lib/features/auth/` | Sign-in, the session the app owns, and its rules (access, heartbeat, idle and 8-hour sign-out) |
| `dikho-mobile/lib/features/users/` | Users: people, profiles, access (the permission grid as a list per module), sessions, templates, departments, audit log |
| `dikho-mobile/lib/features/email/` | Email: the overview, the inbox (mailboxes, conversations, each message in a locked view, attachments, filing, notes, CRM records, the composer), analytics, campaigns (audience, content, checklist, approval of the version reviewed, delivery), templates (versions, restore, archive), consent (one address at a time) and Email settings (mailboxes, Google and Hostinger connection, campaign sending limits, people with access) |
| `dikho-mobile/lib/features/live_assist/` | Live Assist: the web's messages, the WebRTC link and its setup channel, pictures of Dikho's screens, the layer over the app while being helped, and the helper's viewer |
| `dikho-mobile/lib/features/settings/` | Settings: profile, preferences (theme, start page), devices, and for `settings.manage` the company's invoice details, display formats, dropdown lists and media |
| `dikho-mobile/lib/features/whatsapp/` | WhatsApp dashboard with hand-drawn charts, a screen per campaign, contacts, and templates with previews |
| `dikho-mobile/lib/shared/paged_rows.dart`, `record_ui.dart` | What every native record screen shares: paging (the next page is asked for about a screen and a half before the end), search (a thin line under the box shows a new search loading while the old rows stay), placeholder rows on a first load, rows, details cards |
| `dikho-mobile/lib/shared/supabase_rest.dart` | Reads and writes tables through Supabase REST with the person's own session, so RLS decides |
| `dikho-mobile/lib/features/device_contacts/` | Phone contacts: calling and template sends |
| `dikho-mobile/lib/features/splash/` | The logo animation, drawn from compiled-in paths |
| `dikho-mobile/lib/features/updater/` | Update check, download, verification and screens |
| `dikho-mobile/android/app/src/main/kotlin/` | Native layer: files, installer, contacts, calls, recorder, origin-pinned bridge |
| `dikho-mobile/android/app/src/direct/` | What only the self-updating build has |
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

## The keys, in plain words

An app has very few real secrets, and they are not like API keys. Only the first row
below exists to be protected, and only the owner should create it.

| Key | Why it exists | Where it lives | If it is lost or leaks |
| --- | --- | --- | --- |
| Android signing key (`release.keystore`, `key.properties`) | Proves an update comes from the same publisher. Android refuses an update signed by anyone else. | On the machine that builds, plus two encrypted offline backups. Never Git, never chat, never Cloudflare secrets, because the Worker never signs anything. | Lost: nobody can ever be updated, and everyone must reinstall. Leaked: anyone could sign something Android accepts as an update. |
| Certificate fingerprint | The public half of the above. `assetlinks.json` uses it so Gmail sign-in can return to the app. | Public, in the repository. | Not a secret. |
| Supabase publishable key, CRM and API addresses | Say which server to talk to. | Public. The app gets them from the page or at build time. | Not secrets. RLS and the API protect the data. |
| Meta token, Supabase secret key and the rest | Run the business: send messages, read everything. | Cloudflare secrets and Supabase, as today. **Never in the app.** The release scan checks for them. | As already described in `docs/CONFIGURATION.md`. |
| Later, Google Play | An upload key, if you let Google hold the signing key. A key from Firebase if push notifications are added. | Same rule as the signing key; Firebase's server key goes in Cloudflare secrets. | An upload key can be replaced through Google. |
| Later, Apple | A distribution certificate and provisioning profile, made in Apple's developer portal. | The Mac that builds, and the Apple account. | Can be revoked and reissued through Apple. |

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
`~/.config/dikho-android/release/`, readable only by you, writes the public fingerprint
to `public/.well-known/assetlinks.json` for you to commit, and prints how to make the
backup. It refuses to overwrite an existing key. Then:

1. Make the encrypted backup it prints, and keep **two copies somewhere other than this
   machine**, for example a USB drive and a cloud folder, with the passphrase in a
   password manager.
2. Record who holds them and test restoring one. A backup you have never restored
   is a hope, not a backup.
3. Never put `release.keystore` or `key.properties` themselves in Git, chat, email or an
   unencrypted cloud folder. `*.keystore`, `*.jks` and `key.properties` are ignored by
   Git. This repository is public, so a mistake here cannot be recalled.

## Build a release

```bash
export DIKHO_KEY_PROPERTIES=$HOME/.config/dikho-android/release/key.properties
```

```bash
dikho-mobile/tool/build-release.sh
```

The app signs people in itself ([ADR 0013](decisions/0013-native-sign-in.md)), so it is
built with the Supabase project address and publishable key. Both are public, but the
address stays out of this public repository: the script reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` from the repository's `.env.local` (the file the web is
built with), or `DIKHO_SUPABASE_URL` and `DIKHO_SUPABASE_PUBLISHABLE_KEY` when set, and
refuses to build without them. It never prints them.

The script prints the APK path, size, SHA-256 and signer. It builds for `arm64` only
(64-bit phones, which is nearly every phone sold in recent years); a phone that can
run only 32-bit apps cannot install it. `android/app/build.gradle.kts` keeps only the
native libraries of the build's `--target-platform`: plugins ship theirs for every kind
of phone, and WebRTC's alone would otherwise put about 10 MB of unused code in the APK. With no key configured Gradle fails on purpose,
and it never falls back to a debug key.

Release builds shrink and obfuscate: R8 for Kotlin and Java, with Android log calls
removed (`android/app/proguard-rules.pro`), and `--obfuscate --split-debug-info` for
Dart. `debugPrint` does nothing in a release. The script copies the Dart symbols to
`~/.config/dikho-android/symbols/<version>/`. A crash report from that version cannot be
read without them, so keep them for as long as it is installed anywhere.

There are two build flavours. `direct` is the one this document describes. `play` is for
Google Play: see [Stores](#stores).

Before each release, raise `version` in `dikho-mobile/pubspec.yaml`. The number
after the `+` is the version code, which must go up every time, for example
`1.1.0+2`.

| Build | Size |
| --- | --- |
| Release, `arm` + `arm64`, before WebRTC and PdfBox (2026-11-07) | 15,082,355 bytes (14.4 MiB) |
| Release, `arm64` only, with WebRTC and PdfBox (2026-11-19) | 17,575,806 bytes (16.8 MiB) |
| The same before keeping one kind of phone's libraries and dropping Bouncy Castle | 28,752,238 bytes (27.4 MiB), over the limit below |
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
Google's redirect comes back to the app through an Android App Link on
`/email/connect`, which the app finishes natively with its own session (the same
`POST /api/email/oauth/google/complete` the web page uses), then shows the outcome on
native Email settings. That needs a
public file on the CRM's origin, `public/.well-known/assetlinks.json`, which the key
script writes with the fingerprint. Commit it.

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
node cloudflare-updater/scripts/add-release.mjs --apk dikho-mobile/build/app/outputs/flutter-apk/app-direct-release.apk --notes "What changed, in plain words."
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

A release is optional unless you say otherwise. To make it a major update, which anyone
older must install before the app will open, add `--required`. Use it for real
incompatibilities or a security fix: it stops people working until they update. If it
was a mistake, lower `minSupportedVersionCode` in `releases/manifest.json` and deploy, and
everyone is released at their next check.

### First install for staff

**Play Protect blocked a test build on 2026-11-09.** During the emulator update test,
Play Protect scanned the 1.1.1 test APK and answered "Harmful app blocked: This app may be
harmful", then cancelled the install. Two days earlier the same flow said the app looked
safe. Google gives no reason. The app reads contacts, places calls, records audio and
installs its own updates, outside Play, signed with an unknown key, which is the pattern
Play Protect is built to stop. Expect the same for the production APK until Google knows
it. Before a staff rollout:

1. Register `in.dikho.crm` under Android developer verification with the production key
   (see below), and submit the app through Play Protect's appeal form for developers.
2. Better: distribute the `play` build as a private app through Managed Google Play, or a
   closed testing track. Play-installed apps are not blocked this way, and Play handles
   updates.
3. Test a production-signed APK on a real phone with Play Protect on, before telling staff.

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
- **Every start of the app checks**, and so does returning to it after 30 minutes. A
  failed check is silent and tried again next time.
- **A required update blocks the app.** It shows nothing but the update screen, with no
  way past it, and Back leaves the app. This is remembered, so closing the app or losing
  the network does not get round it. "Check again" asks the server, for the case where
  the requirement was withdrawn.
- **An optional update can be put off.** "Later" lasts until the app is closed, and the
  next start asks again.
- **The newest release wins.** The server only ever offers the latest one, so an ignored
  minor update is forgotten as soon as a newer release exists, and someone who skipped
  it goes straight to the newest version, which contains it. Someone below a major update
  must still install the newest, even if the newest is itself a minor one.
- **Android always asks for confirmation.** The first update also asks the person to
  allow Dikho CRM to install apps, and Play Protect may offer a scan. There is no silent
  install on ordinary phones. Android then closes the app and leaves the person on the
  home screen, so they reopen it themselves.
- **Sign-in survives an update.** The session is in the Android Keystore-backed vault,
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

## Stores

### Google Play

Play forbids an app from installing its own updates, so there is a separate `play`
flavour with the same app ID. It has no `REQUEST_INSTALL_PACKAGES`, never downloads an
APK and shows no optional-update prompts, because Play updates it. A required update
still blocks, and its button opens the Play listing.

```bash
dikho-mobile/tool/build-release.sh --play
```

That produces `build/app/outputs/bundle/playRelease/app-play-release.aab`. What the owner
needs before a first upload, none of which is done:

1. A Play Console organization account: $25 once, and a D-U-N-S number.
2. **Decide who holds the signing key, once.** Upload the production key to Play App
   Signing if the direct APK and the Play build should be able to update each other's
   installs. Otherwise Google generates its own key and the two can never replace each
   other, and `assetlinks.json` needs both fingerprints.
3. A privacy policy URL and the data safety form. The form must declare: contacts read
   on the device (not uploaded, except the one number a template goes to), audio recorded
   for voice notes, phone numbers and messages sent to WhatsApp through the API.
4. A prominent explanation before asking for contacts. The Phone contacts screen already
   shows one. `CALL_PHONE`, `READ_CONTACTS` and `RECORD_AUDIO` are all allowed for this
   use, but Play's review may ask for a demonstration and a test login.
5. Google Play may refuse a public listing for an internal tool. A private app through
   Managed Google Play, or closed testing, fits staff-only use better.
6. Raise `versionCode` across both flavours: they share one number line, because the
   update server's minimum applies to both.

### Apple App Store

Not started, and not possible from this machine. It needs a Mac with Xcode, and an Apple
Developer organization account ($99 a year, also needs D-U-N-S). Flutter's Dart code
carries over, but these do not:

- The Kotlin layer (`CrmPlatformPlugin`, bridge, contacts, recorder, player, file saving)
  has to be rewritten in Swift. There is no `ios/` folder yet.
- iOS has no `ACTION_CALL`: calling always goes through its own confirmation.
- The self-updater cannot exist. Apple allows updates only through the App Store, or
  TestFlight or a Custom App for staff-only use.
- App Review can refuse an app that is mostly a website (guideline 4.2), which is one more
  reason to keep moving modules native.

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

Scenarios are `web`, `files`, `layout`, `native`, `walk`, `updates`, `upgrade`,
`reinstall`, `save-dialog`, `tls` and `no-debug`. `updates` and `upgrade` take
`--updates`, `--old-apk` and `--new-apk`, and `upgrade` also takes `--other-signer-apk`.
`reinstall` takes `--old-apk`. `save-dialog` needs a build with
`--dart-define=FORCE_SAVE_DIALOG=true`, and `tls` one with
`--dart-define=UPDATE_BASE_URL=https://<real host>`. `native` covers the drawer, inbox,
realtime, voice notes and Phone contacts, and needs an emulator with audio input.
`walk` opens every web module at phone size, taps the first row and the main button, and
writes `walk-report.json` next to its screenshots. Native screens are covered by `native`.

Test builds are obfuscated like real releases, so these runs exercise the same compiled
code.

Use `-gpu host` if the machine has a GPU. The emulator itself crashed repeatedly on
this project's test machine (a `RenderThread` segfault in `qemu`, with "invalid color
buffer" in its log). The software renderers did so within minutes and `host` only
rarely, so restart it and repeat the scenario if `adb` loses the device. Uninstall
first when going down a version: `adb install -r` refuses a lower version code.

Test builds are marked by `LOCAL_TEST_BUILD`, permit plain http to `localhost` and
have WebView debugging on. `tool/build-release.sh` cannot produce one, and a normal
build refuses a non-https origin at startup.

### Results

#### V1.1.0, 2026-11-07

On an Android 16 emulator with Google Play (WebView 133), against the fake backend, with
obfuscated test APKs signed by the test key.

| Check | Result |
| --- | --- |
| `flutter analyze` | clean |
| `flutter test` | 171 passed |
| `npm run check` (lint, tests, build, secret scan) | passed |
| `native`: drawer, native Clients (paging, details, edit and add through Supabase, unsaved-change prompt, New order into the native order form, Back on the start screen), native Leads (paging, search on the server, WhatsApp state, details, a link handed to another app), inbox paging, search, realtime, send, voice note recorded and accepted by the API's own check, microphone released on leaving a chat, Phone contacts, template to a number with consent and refusal, direct call, native Templates with previews, native WhatsApp dashboard (figures, changes, charts, range, button taps), a campaign's own screen and Back, the page handing `/whatsapp` to the app, native WhatsApp Contacts (server search, details, select and delete after asking, the web importer and Back), native Campaigns (progress, a campaign's screen, the new-campaign wizard sending once with a request id), native Vendors (details with the account masked, New PO into the web form, a new vendor saved vendor first then address), native Sales orders (purchase orders left out, the page handing `/sales-orders` to the app, figures and lines, Tax invoice saved as a PDF by the web page and Back to the list, a new order saved order first then its line with GST worked out), session across a restart, sign-out | 55 of 55 (2026-11-13) |
| `orders`: signs in through the app, then native Sales orders and Purchase orders (lists, details, the tax invoice drawn on the phone and its text read back from the saved PDF, tax total included, a new order and a new purchase order saved step by step) | 6 of 6 (2026-11-19) |
| `contacts`: signs in through the app, then native WhatsApp Contacts' import: a CSV with a title line written on the phone and chosen in Android's own file picker, its columns found, a landline and a blank number explained, only the two good rows sent (a +44 number kept British), the list showing them | 3 of 3 (2026-11-20) |
| `signin`: the app's own sign-in on a fresh install with nothing of the CRM loaded, a WhatsApp code with a wrong one first, the session kept across a force-stop, a session ended on the server signing out with the reason shown, email sign-in then sign-out from the drawer ending only this session, signed out after a relaunch | 6 of 6 (2026-11-17) |
| `users`: signs in through the app, then native Users (the people with counts, the page handing `/users` to the app, a person's details and sessions naming the app, a permission switched off saved as the one change) | 4 of 4 (2026-11-17) |
| `email`: signs in through the app, then the native email overview (figures, the mailbox) and analytics, native email templates and campaigns (a draft written on the phone, its audience counted, saved with the audience), native consent (an address looked up, consent recorded with how they agreed), native Email settings (the shared mailbox, a person added to it, Google's return finished by the app), and the native email inbox (opened from the drawer with the page left where it was, the page handing `/email/inbox` to the app, a conversation marked read and its message shown in the locked view, a link asked about and not followed, an attachment downloaded with the session and saved, status set to Done, a reply sent once to the sender in the conversation) | 10 of 10 (2026-11-19; the attachment check now waits for the app's record of the save, since the short "Saved" message could fall between two screen reads) |
| `assist`: signs in through the app; a helper signed in on a computer (headless Chrome, a second fake user) asks to see the app user's screen; the app says what will be shared and shares it; connected directly over WebRTC, the browser shows the app's screen and which screen they are on; a note pinned where the helper clicked shows on the phone and Done goes back; chat both ways; Stop ends it on both sides | 7 of 7 (2026-11-19) |
| `settings`: signs in through the app, then native Settings (opened from the drawer, the page handing `/settings/...` to the app, the theme changed at once, saved and followed by the page, your devices with another one signed out, the company's invoice details, a dropdown value added once) | 6 of 6 (2026-11-19, with the phone save bar) |
| `updates`: optional asks and Later lasts the run, next start asks again, newest replaces an ignored minor and blocks, Back leaves, blocked offline across a restart, Check again unblocks, a real install lifts the block | 9 of 9 on 2026-11-07; on 2026-11-09, 8 of 9: Play Protect blocked the install as harmful (see "First install for staff") |
| `web`: sign-in, session, navigation, back through drawer pages, keyboard, rotation, dark mode, offline, deep links, server errors, a real tax invoice, sign-out | 22 of 22 |
| `walk`: 18 web modules at phone size, first row and main form opened, no sideways overflow or cut-off text | 18 of 18 |
| `files` (downloads, uploads, dialogs, bridge isolation), `upgrade` (1.1.0 to 1.1.1 through the app), `layout` | 28 of 28 (the clock check needs a rooted image, not run), 11 of 11, 15 of 15 |
| Native screens on 320dp and 360dp, dark mode, 130% and 150% text, landscape with keyboard | checked by screenshot |
| `flutter build appbundle --flavor play` | builds; no `REQUEST_INSTALL_PACKAGES` |
| Secret scan of the test APK, plus Dart names | clean; Dart class names obfuscated, Android log calls removed |

Not run: real phones, a real sign-in, Meta delivery of a voice note or template, real
Supabase Realtime, the deployed update Worker, an APK signed with the production key,
Android 7 to 15 for the new native screens, and the Play build on a device.

#### V1.0.0, 2026-11-05

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
| Update dialog never appears | Said "Later" since the app was opened, or the app is up to date. Close and reopen the app, and check the API with `curl`. |
| Stuck on "Update required" | The server says this version is below its minimum. Install the update, or lower `minSupportedVersionCode` and deploy, then tap "Check again". |
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
- Requests from a page for camera, microphone and location are denied. The manifest
  has no camera or location permission.
- `READ_CONTACTS`, `CALL_PHONE` and `RECORD_AUDIO` are asked for at the moment they are
  needed, and only native screens can use them. The page has no route to contacts, calls
  or the recorder. Contacts stay on the phone: the only thing that leaves is the one
  number a template is sent to.
- The Supabase session is encrypted with an Android Keystore key
  (`flutter_secure_storage`), not left in WebView storage. Access tokens are held in
  memory only. Media fetched for a person is deleted when they sign out.
- Sending a template to a number from Phone contacts needs `campaigns.send`, refuses
  opted-out and blocked numbers, repeats within two minutes and anything past a daily
  ceiling across all staff (`WHATSAPP_DIRECT_TEMPLATE_DAILY_CAP`, fails closed), and
  asks the sender to confirm the person agreed to hear from you.
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
- **Voice notes reach WhatsApp as voice notes on Android 10 and later.** Those phones
  record OGG/Opus. Older ones record AAC, which goes as an ordinary audio message.
- **The inbox exists twice**, in React for browsers and in Dart here. A change to one
  needs the other, and an app change needs an APK.
- **A helper sees a phone at a few pictures a second**, not smooth video, and a CRM page
  still shown by the WebView comes out blank to them until the WebView is removed
  ([ADR 0014](decisions/0014-live-assist-on-phones.md)).
- **Templates with a media header cannot be sent from the app or the browser inbox.** They
  are listed as unavailable with the reason.
- **No offline use.** The app shows a failure screen and retries. Nothing is cached for
  offline reading, and no change is queued.
- **No push notifications.** New WhatsApp messages only show while the inbox is open.
  This is the biggest gap for daily use: it needs Firebase Cloud Messaging, a Firebase
  key in Cloudflare secrets, and a Worker change to send on an inbound message.
- **No crash reports leave the phone.** A crash is only known if someone says so. Adding
  a reporting service is a data-handling decision for the owner.
- **A WebView renderer crash restarts the app.** `webview_flutter` does not expose a
  way to recover in place. The session survives.
- **Android 7 to 9 are lightly covered.** They need WebView 111 or later, which their
  emulator images do not ship. Their save-dialog path was run on a newer Android
  through a test flag instead.
