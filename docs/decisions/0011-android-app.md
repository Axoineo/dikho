# 0011: Android app as a Flutter shell with a Cloudflare update service

Status: Proposed
Date: 2026-11-04

## Context

Staff want the CRM as an installable Android app without depending on Google
Play. The CRM is a React SPA with one source of truth for business logic: RLS in
Supabase, the API Worker and the database rules. Phone layouts were fixed in PR
#49, so the web UI is already usable at phone widths. There is no service worker,
and `index.html` and assets are served `max-age=0, must-revalidate`, so a loaded
page is always the current deployment.

Things the repository audit found that shaped the design:

- Sign-in is Supabase email OTP and WhatsApp OTP, both in the page. Google OAuth
  exists only for connecting a Gmail mailbox, and Google refuses embedded
  WebViews for that.
- Most files are `blob:` links that the page revokes on the line after clicking
  (invoices, Excel exports, email attachments). WebView cannot save those at all.
- `window.confirm` guards contact deletion, campaign sends and subject-less
  email. `webview_flutter` answers `false` unless the app handles it, so those
  buttons would silently do nothing.
- WhatsApp PDF previews use an `<iframe>`, and WebView has no PDF viewer.
- `dikho.in`'s DNS is at Hostinger. A Worker Custom Domain needs the zone on
  Cloudflare, so a Worker cannot serve `updates.dikho.in` today.

## Decision

1. **A Flutter shell around the production CRM.** `dikho-mobile/` loads
   `https://manage.dikho.in` in `webview_flutter` and draws only what the page
   cannot: the splash, failure screens, JavaScript dialogs and the update flow.
   There is no second database, no duplicated business logic and no separate
   credential. Web releases reach the app on the next load, with no APK.

2. **Navigation is an allowlist in one pure function.** `NavigationPolicy` keeps
   the exact CRM origin in the WebView, sends a fixed set of schemes to other
   apps and refuses everything else, including `intent:`, `file:`, `content:` and
   `javascript:`. Signed storage links and ticketed media links are fetched
   natively with no cookie or token, so they never land in a browser's history.

3. **The page reaches native code only through an origin-pinned message channel.**
   `WebViewCompat.addWebMessageListener` and `addDocumentStartJavaScript`, both
   pinned to the CRM origin, rather than `addJavascriptInterface`, which would be
   callable from any frame or redirect target. The bridge can do three things: hand
   over a file, copy text when the WebView refuses `navigator.clipboard`, and report
   the page's edge colours. Every message is validated and bounded. Reached through
   the plugin's documented `WebViewFlutterAndroidExternalApi`.

4. **Small native layer, few dependencies.** Kotlin handles downloads (MediaStore,
   or the system save dialog before Android 10), the document picker, opening and
   sharing files, and the installer. Only `webview_flutter`, `crypto` and
   `androidx.webkit`/`core` are added. Permissions are `INTERNET`,
   `ACCESS_NETWORK_STATE` and `REQUEST_INSTALL_PACKAGES`.

5. **Self-update with Android's own installer.** A separate read-only Worker
   (`cloudflare-updater/`) answers version checks. The app downloads the APK to
   private storage, checks its size and SHA-256, confirms the package, version and
   signer, then commits a `PackageInstaller` session. Android always shows its own
   confirmation and enforces the signature itself. The check runs after the CRM
   has loaded and never delays or blocks it.

6. **`mandatory` is a minimum-supported-version policy.** It is computed per
   caller against `minSupportedVersionCode`. A failed mandatory update offers
   "Continue for now", so an outage or a full disk cannot lock staff out of work.

7. **APKs are Workers Static Assets.** The measured release APK fits the 25 MiB
   per-file limit, downloads cost no Worker invocation or CPU, and publishing is
   an authenticated `wrangler deploy`. There is no write route to protect.

8. **The update host defaults to `workers.dev`.** It needs no DNS change, and the
   API Worker already lives on the same account subdomain. Moving later is possible
   by shipping an update with the new address while keeping the old service up.

## Alternatives considered

- **Capacitor.** A natural fit for a React app, and its shell is smaller because
  it has no engine (Flutter adds about 7.5 MB per architecture). It would still
  load the same system WebView from the same remote URL, and the hard parts here
  are identical either way: blob capture, the installer flow, origin-pinned
  messaging and the update service. Nothing found was a substantial Flutter
  blocker, so the owner's preferred stack stands. If APK size ever matters more
  than it does now, this is the alternative to revisit.
- **`flutter_inappwebview`.** Has built-in download and window callbacks, but it is
  a much larger third-party surface for a privileged WebView, and the official
  plugin's external API covers the gaps in a few lines.
- **Trusted Web Activity or a PWA.** No self-update of native behaviour, no control
  over dialogs, and file handling stays browser-defined.
- **A native CRM UI.** Duplicates every screen and rule, and was ruled out by the
  brief.

## Consequences

- The app needs Android System WebView 111 or later, because the CRM's build
  target does. Older phones get a clear "update WebView" screen, not a blank page.
- The signing key becomes a permanent, unrecoverable business asset. See
  `docs/ANDROID.md`.
- Publishing needs the owner's Cloudflare login. Automated publishing is deferred.
- Android developer verification will require registering `in.dikho.crm` and the
  signing key before Google's global rollout in 2027, or self-updates will fail on
  certified devices. See `docs/ANDROID.md`.
- The bridge script and the back-button script depend on page structure (Blob URLs,
  `role="dialog"`, `.app-shell`). They fail soft: a miss means a native default
  behaviour, not a crash.

## Verification

- `flutter test` covers navigation policy, configuration, update parsing, the
  scheduler, the downloader and the update flow.
- `node --test cloudflare-updater/test/*.test.js`, also part of `npm test`.
- `dikho-mobile/tool/local-test/device-test.mjs` runs on an emulator against a fake
  backend: sign-in, session persistence, navigation, files, and the signed upgrade.
- Results and what has not been run are recorded in `docs/ANDROID.md`.

## Superseded by

Nothing yet.
