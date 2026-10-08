# 0008: Live Assist by consented tab sharing

Status: Accepted (2026-10-07); amended the same day (see the end)
Builds on: [ADR 0007](0007-user-management-and-permissions.md)

## Context

The owner wants experienced staff to teach new employees by showing rather
than telling: see the employee's Dikho screen and point at things. The first
answer (2026-10-06) was "view and control without asking". On 2026-10-07 the
owner changed it to the recommended option after seeing that the first phase
only showed which section someone was in.

Constraints:

- Browsers will not share a screen without the person's click, so watching
  without consent would mean copying the page another way.
- Anything an admin did "as" the employee would be saved under the employee's
  name, which breaks the audit trail on orders and invoices.
- Customer data is on screen, so the picture must not be stored or relayed
  through a third party unnecessarily.
- The Worker is on Cloudflare's Free plan; Supabase Realtime is already used
  for private, policy-checked channels.

## Decision

- **Consent every time.** A helper asks; the employee accepts (one click),
  then the browser's own picker shares the current tab. Anything other than a
  browser tab (a window, the whole screen) is refused, so nothing outside
  Dikho is shown. A banner stays on screen with a Stop button, and the
  browser's own "sharing" bar can end it too.
- **Watch and point, no control.** The helper sees the tab, moves a pointer
  and highlights things on the employee's screen, and can suggest a page that
  the employee chooses to open (only pages of this app, only ones their access
  includes). The helper cannot click or type for them.
- **Browser to browser.** Video and pointer messages go over WebRTC directly
  between the two browsers, encrypted. The few setup messages travel on a
  private Realtime channel `assist:<session id>` that only the two
  participants of a waiting or live session may join or send on. Nothing is
  recorded. Only STUN servers are configured; a TURN relay can be added if
  some network needs it.
- **Who may help whom** follows ADR 0007: the helper needs `live_assist.use`
  (Admins have it through their role; Owners and developers hold everything)
  and must outrank the employee; Owners can help anyone but themselves.
- **Limits:** a request waits 60 seconds, a session lasts at most two hours,
  one session per helper and per employee at a time, at most 30 requests an
  hour per helper.
- **Ask for help.** Any staff member can ask; everyone who may help them (at
  most 25, most recently active first) gets a card, and "Help now" starts the
  normal consented flow. One open request at a time, 15 minutes, 10 a day.
- **Records.** `live_assist_sessions` and `help_requests`, written only by the
  `la_*` functions through the Worker; the audit log gets requested, accepted,
  declined and ended (with duration and reason) and help requested or
  cancelled. The help message stays on the request, out of the audit log.

## Consequences

- Sharing needs Chrome or Edge on a computer (tab capture); phones and
  Firefox are told so. Watching works anywhere.
- On some strict office or mobile networks a direct connection is impossible;
  the helper is told after 25 seconds. A relay (TURN) would fix that and may
  cost money.
- A reload on either side ends the session (the shared tab and the
  connection do not survive a reload); the dashboard closes stale sessions on
  load.
- New Realtime policies on `realtime.messages`: select and insert for
  `assist:*` topics, participants only.

## Alternatives considered

- **Copying the page into the helper's browser (rrweb) without asking.**
  Rejected with the no-consent option: it needs a new dependency, relays the
  page content through Realtime, and is what made silent watching possible.
- **Remote control.** Rejected: actions would be attributed to the employee.
- **A third-party co-browsing service.** Another processor of customer data
  and a recurring cost for a small team.

## Verification

Local stack with the production Postgres image, GoTrue, PostgREST and the
real Supabase Realtime server: 48 rule checks on the `la_*` functions, 14
channel-authorization checks through Realtime (outsiders cannot join, listen,
inject or forge notices), 10 route tests, and a two-browser run in headless
Chrome with real tab capture covering request, accept, video, pointer,
highlight, page suggestion, stop, Ask for help, Help now and decline (22/22).

## Amendment (2026-10-07): peers, chat, a chosen helper

Asked for by the owner after the first version shipped: Admins also need each
other's help, and a helper who cannot click needs a way to say "click this"
without covering the employee's screen.

- **Same level or below.** The helper needs `live_assist.use` and must be at
  the employee's level or above (`la_can_help`, migration
  `20261008040426_live_assist_peer_help.sql`), instead of strictly above.
  Admins can help Admins, developers developers; Owners as before. This only
  widens who may *ask*: the employee still accepts each time.
- **One session per person, in either role.** Someone sharing their tab
  cannot start helping, a helper cannot be helped, and a second helper cannot
  pile on a request already waiting. Otherwise a shared tab could show the
  viewer of another session and pass a third person's screen to someone they
  never accepted. Accepting re-checks both people and ends the request as
  `busy` if either went into another session.
- **Chat and pinned notes, chosen design "banner + pinned notes".** On the
  employee's screen nothing new covers the page by default: the helper's
  newest message shows under the existing banner with quick replies (OK,
  Done, Where?), the full chat opens only from the banner's Chat button, and
  a note the helper pins sits beside the button or field it points at,
  numbered, until the employee clicks that thing, presses Got it, or changes
  page. Notes keep clear of the banner column and of each other. The helper
  clicks a spot on the shared picture, then types (or picks a quick phrase)
  to pin the note there; their chat is a column beside the picture, never
  over it. Messages travel on the session's WebRTC data channel, are checked
  on arrival (type, length, coordinates), shown as plain text, and are not
  stored anywhere: they are gone when the session ends.
- **Voice** was offered and not chosen for now; it would use the same
  connection.
- **Ask for help can name one person** (`help_requests.helper_id`), picked
  from the people allowed to help, online first (`la_my_helpers`). Only they
  are told and only they can take it. Without a name, everyone allowed is
  told, as before.

### Verification

Local stack as above: the 48 earlier rule checks (four updated for the new
rule) and 47 new ones (same-level help, demotion during a request, one session
per person in every order, the chosen-helper flow, browser denials); 25 route
and chat-logic tests; and a three-browser run with real tab capture (47/47):
chat both ways, quick replies, pinned notes completed by clicking and cleared
on a page change, typing and unread signals, the busy guard, Admin-to-Admin
help and a help request to one chosen Admin. Screens checked in light and dark
themes and at phone width.
