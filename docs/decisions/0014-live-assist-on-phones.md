# 0014: Live Assist on phones shares pictures of Dikho's own screens

Status: Accepted
Date: 2026-11-17
Amends: [0008](0008-live-assist.md), for the Android app

## Context

Live Assist (ADR 0008) lets a helper see someone's Dikho tab, with their OK, point at
things, pin notes and chat. In a browser the tab is shared as video through
`getDisplayMedia`, limited to the Dikho tab, browser to browser over WebRTC, set up on a
private Realtime channel per session. Android's WebView has no `getDisplayMedia`, so in
the app accepting a request failed, and the page's dialogs were hidden behind native
screens. The owner asked for the whole app to be native and for it to go to the Play
Store.

Android can record its own screen (MediaProjection), but that needs a system prompt every
time, a declared screen-capture foreground service that Play reviews, and on phones older
than Android 14 it shares the whole screen, notifications and other apps included. That
breaks the web's rule that only Dikho is ever shown.

## Decision

The owner chose this on 2026-11-17:

1. **A phone shares only Dikho's own screens.** The app takes a picture of what it draws
   (every route and dialog, from one boundary around the app) a few times a second, as a
   PNG, and sends it to the helper. Nothing outside Dikho can be in it: not the status
   bar, notifications, the keyboard or another app. No Android permission or prompt is
   needed. A CRM page still shown by the WebView is not drawn by the app and comes out
   blank, until the WebView is removed.

2. **Pictures go device to device, never through Dikho's servers.** They travel on a
   second WebRTC data channel, `frames`, beside the existing `assist` channel, cut into
   chunks of at most 16,000 bytes with an 8-byte header (picture number, chunk index,
   chunk count). The web viewer puts them back together (`frames.js`) and shows only
   PNGs. An unchanged screen is sent again only every few seconds, pictures stop while
   the app is in the background, and a slow connection gets fewer pictures rather than
   a growing queue.

3. **Helpers can help from a phone too.** The native viewer shows a computer's tab as
   video, or a phone's pictures. Dragging points, tapping highlights and pins the next
   message there as a note, and the chat, page suggestions and End work as on the web.

4. **Same protocol, same rules.** The app speaks the web's messages (`chat.js`) and
   checks them the same way, joins the same `assist:<session>` channel with the person's
   own token, and calls the same `/api/assist` routes. Who may help whom, one session at
   a time, and the time limits stay the database's. The page in the app leaves Live
   Assist to the app when `window.__dikhoNative.screens` lists `live-assist`, so a
   request never shows two dialogs; an older APK keeps the page's.

5. **One new dependency:** `flutter_webrtc` (1.6.3, MIT), for WebRTC in the app. It
   declares no Android permissions of its own.

## Consequences

- No screen-recording permission or foreground service to declare for Play, and
  nothing outside Dikho can leak to a helper.
- A helper sees a phone at a few pictures a second, enough to guide, not smooth video.
- Pages still in the WebView are blank to a helper until the WebView goes.
- A strict network that blocks a direct connection blocks Live Assist on phones as it
  does in browsers; a relay (TURN) would be the fix for both.
- The APK grows by the WebRTC library.
