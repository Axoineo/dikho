# 0012: Native screens in the Android app, and hard minimum versions

Status: Accepted
Date: 2026-11-06

## Context

ADR 0011 made the app a thin shell: the CRM in a WebView, with native code only for
what a page cannot do. On phones the WebView inbox felt like a web page: it could not
page or search past 200 chats, opening a chat held 500 messages in the page, and voice
notes never worked. The owner asked for a native app and chose, on 2026-11-06, to build
the inbox and the navigation drawer natively. They also asked for phone contacts with
direct calling, and for updates that can be required.

The owner's longer-term preference is a fully native app with no WebView at all. That
is about 24,000 lines of React (invoices, Excel export, email rendering, Live Assist
among them), so it is not done in one step. On 2026-11-07 the owner chose to move the
remaining modules one at a time. This ADR is written so each module can move across on
its own while the app keeps working.

## Decision

1. **Native where it pays, the WebView for the rest.** The drawer, top bar, WhatsApp
   inbox and Phone contacts are Flutter. Every other module stays the React page, in the
   WebView, until it is moved. Moving one means giving its drawer entry a native screen.

2. **The page keeps the session.** *(Amended 2026-11-14 by [ADR 0013](0013-native-sign-in.md): the
   app now signs people in and owns the session; the page reads it.)* Sign-in, token refresh, the access check, idle and
   forced sign-out all stay in the CRM page, which already does them and stays loaded
   behind the native screens. A native screen asks the page for a current access token
   through the bridge, holds it in memory for the request, and sends it to the API like
   any browser. There is no second credential and no second refresher to race the first.
   When the last module has moved, the app takes over refreshing and the page goes.

3. **The session lives in the Android Keystore.** `flutter_secure_storage` holds it, and
   the page reads and writes it through `page_bridge.js` and `src/lib/shellVault.js`,
   instead of WebView `localStorage`. Browsers are unchanged.

   Moved so far: the inbox and Phone contacts (2026-11-06), Leads (2026-11-07), Clients,
   Templates, the WhatsApp dashboard with a screen per campaign, WhatsApp Contacts, and
   Campaigns with a native new-campaign wizard, and Vendors (2026-11-09), and Sales orders
   (2026-11-12, its tax invoice PDF from the web page `/sales-orders/:id/invoice`), and Purchase
   orders (2026-11-13), and Users (2026-11-17, its permission grid redesigned as a list per
   module for the phone). The wizard sends a one-time
   request id and never repeats a request by itself, so it ships only after D1 migration
   0013 and the request-id fix are live (docs/ANDROID.md). Where a web feature would be a large rewrite for little use on a phone, the
   native screen opens the web page for it on its own route (Contacts opens the
   spreadsheet importer at `/whatsapp/contacts/import`), through the screen's route so
   Back returns to the native screen. Writes go the same way as reads: an insert or update with the person's
   own token, never repeated after a dropped connection, and RLS refusing an update shows
   as "you may not have permission" rather than a silent no-op.

   Back on a native screen the app opened on (the page sits on that screen's own route)
   follows the page's history, and with none asks before leaving, as on any first screen.
   Opened from the drawer over another page, Back returns to that page.

   A native screen reads Supabase tables through its REST API with the same access
   token and publishable key the page's supabase-js uses (`lib/shared/supabase_rest.dart`),
   so RLS decides exactly as it does for the page, and API routes through the Worker as
   before. The page tells the app which routes it hands over:
   `window.__dikhoNative.screens` lists the screens this copy of the app draws, so a web
   release that hands a route to the app cannot strand an older APK on an empty page.

4. **The bridge grows, narrowly.** The page may tell the app: who is signed in and what
   they may open, which page is showing, the theme, that it has painted, that a session
   warning is up, and a token when asked. It may ask to open the inbox. All of it is
   parsed and bounded in `shell_messages.dart`, none of it is used to authorize anything,
   and the vault takes only Supabase's own session keys. The page still cannot read
   contacts, place a call or use the recorder: nothing connects it to those.

5. **Realtime goes direct.** The native inbox joins the same private channel the browser
   does, over its own socket, because the page behind it is hidden and its timers are
   throttled. A slow re-read of the first page covers whatever the socket misses.

6. **Voice notes are recorded natively.** `MediaRecorder` writes OGG/Opus on Android 10
   and later, and AAC in MP4 before that, sent as an ordinary audio message. The upload
   goes through the same API route, with the same checks, as the browser's.

7. **Device features are a little Kotlin, not plugins.** Contacts, `ACTION_CALL`,
   recording and playback are short, and this app holds powerful permissions, so fewer
   third-party hands is better. `permission_handler` and `flutter_secure_storage` are the
   two exceptions, because the owner named them.

8. **Two kinds of update.** Replaces ADR 0011's decision 6, which let anyone continue
   past a failed mandatory update.
   - **Required:** the caller is below `minSupportedVersionCode`. The app shows only the
     update screen until it is installed. It is remembered across restarts, so closing
     the app or going offline does not get round it. Releasing with `--required` sets it.
   - **Optional:** "Later" lasts until the app is closed, and the next start asks again.
   - **Newest wins:** the server only ever offers the latest release, and Android updates
     are whole APKs, so someone who ignored a minor update is taken straight to the next
     major one, which contains it. Someone below a major update must still install
     whatever is newest, even if that release is itself minor.
   - An outage changes nothing: a failed check blocks nobody new. If a required release
     was a mistake, lowering the minimum releases everyone at their next check.

## Alternatives considered

- **Everything native now.** The end state the owner prefers, but a rewrite of the finance
  screens all at once is not what "production ready" means. Module by module reaches the
  same place and keeps a working app at every step.
- **Native inbox with the page relaying realtime.** Less code, but it depends on a hidden
  page's timers, which Android throttles.
- **Native sign-in now.** Needed once the WebView is gone, but until then it would mean
  two things refreshing one rotating refresh token.
- **`flutter_contacts`, `flutter_phone_direct_caller`, `record`, `just_audio`.** All fine,
  and all more third-party code in an app that can read contacts and place calls.

## Consequences

- The inbox now exists twice, in React and in Dart. A change to one needs the other, and
  `tests/inbox-thread-paging.test.js` and `dikho-mobile/test/inbox_models_test.dart` hold
  the shared rules in step. Inbox changes in the app need an APK to reach people.
- The native screens need a web deploy to work: the session bridge is in the page. Deploy
  the API, then the web app, then publish the APK.
- A required update can lock people out if the new APK is broken. The way out is on the
  server: lower the minimum.
- Live Assist's prompts appear in the page, so they are not seen while a native screen is
  on top, and a helper cannot view a native screen.
- Google Play forbids self-updating and restricts `REQUEST_INSTALL_PACKAGES`, so a Play
  build needs its own update path. See `docs/ANDROID.md`.

## Verification

Results and what has not been run are recorded in `docs/ANDROID.md`.

## Superseded by

Nothing yet.
