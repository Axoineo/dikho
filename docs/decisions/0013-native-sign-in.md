# 0013: The Android app signs people in and owns the session

Status: Accepted
Date: 2026-11-14
Amends: [0012](0012-android-native-screens.md), decision 2 ("The page keeps the session")

## Context

ADR 0012 left sign-in, token refresh and sign-out to the CRM page in the WebView, with
native screens asking the page for a token. On 2026-11-14 the owner asked for the whole
app to be native, sign-in included, and for it to be published on the Play Store later.
A native app cannot depend on a web page to sign in, and while some modules are still
web pages, the app and the page need the same session without fighting over it.

Supabase rotates refresh tokens: each works once, and a refresh token used again after a
short grace period is treated as stolen and ends the whole session. Two refreshers on one
session (the app and the page's supabase-js) would sooner or later race and sign the
person out.

## Decision

1. **The app signs people in.** A native screen asks Supabase Auth for a six-digit code
   by email or WhatsApp (`create_user` false: nobody new is created, as on the web), and
   verifies it. The session goes to the Android Keystore through flutter_secure_storage,
   under supabase-js's own key, in supabase-js's own format. The device check the web
   makes after signing in is made too.

2. **The app is the only refresher.** `AuthController` refreshes five minutes before
   expiry, one refresh at a time, and again on return to the foreground. Native screens
   take their tokens from it.

3. **The page reads the app's session.** The page's vault (ADR 0012) now answers from
   `AuthController`: a read gets a session with more than five minutes left, so
   supabase-js (which refreshes under 90 seconds) never needs to. In the app, the page's
   client runs with `autoRefreshToken: false`, and any refresh it still attempts is sent
   to the app instead of Supabase (`window.__dikhoNative.auth.refresh`), which answers
   with the session it holds. An older page that refreshes by itself writes the new
   session to the vault, and the app adopts it.

4. **Signing out.** The app's sign-out ends only this phone's session on the server
   (`scope=local`), not the person's other devices, then clears the vault and unloads the
   page. When the page signs out (an administrator ended the session, it timed out, the
   person has no access), the app signs out too and says why on its sign-in screen.

5. **The page loads only once someone is signed in.** Until then the WebView holds an
   empty document, and nothing of the CRM is fetched.

6. **Build settings.** The Supabase address and publishable key are compiled in
   (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`). They are public, but the project address
   stays out of this public repository: `tool/build-release.sh` reads them from the
   web's own `.env.local` or from `DIKHO_SUPABASE_*`, and a build without them shows
   "This build is misconfigured" instead of starting.

7. **The session's rules are the app's too** (2026-11-17, `SessionGuard`). The app reads
   `my_access` itself (what the drawer offers comes from it, with the web's page rules
   ported to `page_access.dart`), sends the activity heartbeat (`touch_session`), records
   the sign-in (`/me/session`, as "DikhoCRM/<version> (Android)"), signs out after 45
   minutes without activity (warning for the last 5) or 8 hours after signing in, and
   listens on the person's `staff:<id>` channel for an administrator ending the session.
   In an app that owns the session the page skips all of these and only reports, at most
   every 30 seconds, that it was used. The 8 hours count from signing in on the phone;
   the web counts them from when its page was loaded.

## Still in the page, for now

Live Assist (its state and its notices on the staff channel) and the page's theme. They
move with the remaining modules, after which the page, and the WebView, go.

## Consequences

- One refresher, so no refresh-token race between the app and the page.
- Deploy order: the web change (page reads the app's session, reports why it signed out)
  goes live before an app with this change. An app with this change and an older page
  still works, through decision 3's adoption; an older app with the new page is
  unaffected, because the page changes only when the app says it owns the session.
- Signing out of the app no longer signs the person out of their computer. The web's own
  sign-out and its idle timeout still end every session of the person (supabase-js's
  default `global` scope); that is a separate web decision.
