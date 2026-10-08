# Task: WhatsApp-style inbox actions

Status: active (built and verified locally; waiting on the production rollout)
Owner: Dikho Global Media LLP
Started: 2026-10-07
Last updated: 2026-10-08

## Goal

The inbox works like WhatsApp for agents, with everything Meta's Cloud API
lets a business do in a chat.

## Built

- Compact bubbles (29px for one line, was 54px: preflight is off, so `<p>`
  kept 1em margins), the clock on the last line's baseline, and an original
  doodle wallpaper (`scripts/gen-chat-doodles.mjs`).
- Chat actions: Clear chat, Delete chat, Block, Unblock, Starred messages.
- Message menu: quick reactions, Reply, Copy, Forward, Pin, Star, Delete.
- Sending: text, files, voice notes (OGG/Opus; Chrome's WebM is re-wrapped in
  the browser by `oggOpus.js`), locations, contact cards, reply buttons,
  lists, link buttons, location and address requests, approved templates.
- Receiving: locations, contact cards, chosen options, address and form
  replies, orders, ad referrals, forwarded labels, system notices, replies
  and reactions shown on their messages.
- Pinned bar, jump to a quoted message, jump-to-latest with a count.
- D1 migrations 0011 (clear/delete/block, pins, stars, hidden messages,
  `context_wamid`, history) and 0012 (`messages.payload`); Supabase
  permissions `inbox.delete` and `inbox.block`.

## Not built, and why

- Edit and unsend: the Cloud API has neither.
- Report, "Ask Meta AI": not offered to businesses.
- Flows, product catalogue messages, the call button and groups: each needs
  set-up on Meta's side first (a published Flow, a catalogue, calling,
  groups eligibility).
- "Played" receipts for voice notes: would change the status ranking shared
  with campaigns and the reconciler; voice notes show read ticks instead.
- Templates with a media header or a link variable: the inbox does not
  collect those values; the API refuses them with a reason.
- A check against Meta's own block list (`GET block_users`) for blocks made
  in other tools.

## Verification

- `npm run check` (112 unit tests on Node 20, 22 and 26, including the OGG
  converter against a real Chrome recording and the message parsers/limits).
- Local end-to-end API test (wrangler getPlatformProxy: local D1 with every
  migration, local R2, Supabase and Meta mocked): 62 checks across allowed,
  denied, malformed, Meta-refused, duplicate and out-of-window cases for
  every route, plus the webhook storing each inbound kind.
- Headless Chrome on `scripts/preview/whatsapp-inbox.html` in light and dark,
  desktop and mobile: each menu, form, dialog and flow, and a real
  fake-microphone recording that ffmpeg decodes.
- Not verified against Meta: block/unblock, reactions, interactive messages,
  voice notes and templates need the live number.

## Rollout order

1. D1, BEFORE the API deploy (applies 0011 and 0012; the API reads and writes
   the new columns, and without them the inbox fails and inbound messages
   park as failed):
   `npx wrangler d1 migrations apply dikho-whatsapp --remote -c wrangler.api.jsonc`
2. Supabase: `20261008045656_inbox_chat_permissions.sql` (rename the file to
   the version MCP records).
3. `npm run deploy:api` from a tree that contains everything already live.
4. Push to `main` for the SPA.
