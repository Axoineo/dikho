# WhatsApp voice calls (inbound)

Customers who message the business number can also **call** it from WhatsApp, and
the call rings inside the CRM. Any signed-in agent can pick it up from whatever
screen they are on; the first to answer gets the call and every other tab stops
ringing. Answered and missed calls both land in the conversation thread.

## How it works

The audio never touches the Worker. Meta sends an **SDP offer** over the webhook,
the agent's browser answers it with a WebRTC peer connection, and the Worker only
relays that **SDP answer** back. Media then flows browser ↔ Meta directly
(ICE + DTLS + SRTP, Opus) — which is why a stateless Worker can carry this at all.

```
Customer taps call in WhatsApp
        │
        ▼
Meta ──webhook `calls` / event=connect (SDP offer)──▶  dikho-api Worker
                                                          │ broadcast call:incoming
                                                          ▼
                                            Supabase Realtime  ──▶  every open CRM tab
                                                                        │ agent clicks Answer
                                                                        │ getUserMedia + RTCPeerConnection
                                                                        ▼
        Worker  ◀──POST /api/whatsapp/calls/:wacid/pre-accept (SDP answer)──┘
          │ claims the call in D1 (one winner), forwards to Meta
          ▼
   Graph /PHONE_NUMBER_ID/calls  action=pre_accept → action=accept
          │
          ▼
   ══ audio: browser ◀────── WebRTC ──────▶ Meta media servers ══
```

When the call ends Meta sends `event=terminate`; the Worker writes the outcome and
duration, drops a bubble into the thread, and tells the tab to tear down.

| File | Role |
| --- | --- |
| `migrations/0007_calls.sql` | `calls` table — one row per call, keyed by Meta's `wacid` |
| `src/api/services/whatsapp/calls.js` | Webhook handling + the answer claim |
| `src/api/routes/whatsapp/calls.js` | `pre-accept` / `accept` / `reject` / `terminate` / history |
| `src/api/services/whatsapp/graph.js` | `sendCallAction` — the Graph transport (pinned to **v23.0**) |
| `src/features/whatsapp/inbox/useWhatsAppCall.js` | The browser's WebRTC side |
| `src/features/whatsapp/inbox/CallOverlay.jsx` | The ringing / in-call card |
| `src/features/whatsapp/inbox/WhatsAppCallCenter.jsx` | Mounted in `AuthenticatedLayout`, so calls ring app-wide |

## Setup

**1. Turn calling on for the number** — already done if WhatsApp Manager ▸ Phone
number ▸ **Call settings** shows *Allow voice calls: On*. Equivalent API call:

```bash
curl -X POST "https://graph.facebook.com/v23.0/$WHATSAPP_PHONE_NUMBER_ID/settings" -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" -H 'Content-Type: application/json' -d '{"calling":{"status":"ENABLED"}}'
```

**2. Subscribe the app to the `calls` webhook field** — *do this last, after
step 4*. This is the step that is *not* covered by the Call settings toggle, and
without it no call ever reaches the CRM. Meta App Dashboard ▸ WhatsApp ▸
Configuration ▸ Webhooks ▸ **Manage**, then tick **calls** alongside `messages`.
The callback URL and verify token are the ones already in use — nothing there
changes.

**3. Apply the migration — before deploying, never after.** The API code calls
`SELECT ... FROM calls`; deployed against a database without that table it fails
silently and leaves no trace in the Worker. This has bitten this project before
(see `0005` and the write-cap outage of 2026-09-25).

```bash
npx wrangler d1 migrations apply dikho-whatsapp --remote -c wrangler.api.jsonc
```

The migration itself needs D1 **write** quota. If the account is over the Free
plan's 100,000 row-writes/day cap it fails with a misleading `code: 7403`
*"account is not authorized to access this service"* — that means quota, not
auth. Confirm with `npx wrangler d1 info dikho-whatsapp -c wrangler.api.jsonc`
(check `rows_written_24h`) and wait for the midnight-UTC reset.

**4a. Deploy the API Worker.**

```bash
npm run deploy:api
```

**4b. Ship the dashboard by merging to `main`.** The dashboard at
manage.dikho.in is a **Cloudflare Pages** project git-connected to
`github.com/axoineo/dikho`, which auto-builds Production from `main`. Do **not**
use `npm run deploy` for it — that deploys the separate `dikho-so-po` Worker,
which no domain points at, so the call UI would silently never go live. Verify
what is actually serving:

```bash
curl -s https://manage.dikho.in/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
```

**5. Only now tick the `calls` webhook field** (step 2). Subscribing before the
table exists means call events arrive with nowhere to land.

No new secrets or bindings — calling reuses `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_APP_SECRET`.

## Things worth knowing

- **A tab has to be open.** The ring is a Supabase broadcast to live browser
  sessions. Nobody signed in means the call goes unanswered — it is still recorded
  as a missed call in the thread, but it does not ring anywhere. If calls need to
  reach people who are not at a desk, that is the SIP option in Call settings
  routing to a real phone system, not this.
- **~30 seconds to answer.** Meta gives roughly 30-60s from `connect` before it
  gives up. The Worker therefore broadcasts the ring *before* it does any D1
  bookkeeping: redelivery, which makes every other webhook recoverable, is
  worthless once the caller has hung up.
- **Microphone permission** is requested the first time an agent answers.
  `manage.dikho.in` is HTTPS, so the grant sticks per browser. A blocked mic
  declines the call rather than leaving the customer ringing into nothing.
- **A call does not open the 24-hour messaging window.** `last_inbound_at` is
  deliberately left alone, so the composer keeps offering templates rather than
  free-form sends that Meta would reject.
- **Business-initiated calls are not implemented.** Only receiving. Meta also
  gates outbound calling behind per-number permissions and a daily cap.
- **Free-plan cost** is negligible: a call is ~4 D1 row writes and 2 subrequests,
  against the 100k writes/day and 50 subrequests/invocation ceilings that campaign
  sends actually strain.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Nothing rings | The `calls` webhook field is not subscribed (step 2), or no tab is signed in |
| Rings, then fails on answer | Mic blocked in the browser, or the 30s window elapsed |
| Connects but silent both ways | The SDP answer was sent before ICE gathering finished, or Meta's offer was echoed back instead of a real answer |
| "Answered on another device" | Working as intended — another tab won the claim |
| Meta returns code 138 | The call already ended; the local row is still written and the UI tears down |
