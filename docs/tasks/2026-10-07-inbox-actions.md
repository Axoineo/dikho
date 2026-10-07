# Task: WhatsApp-style inbox actions

Status: active
Owner: Dikho Global Media LLP
Started: 2026-10-07
Last updated: 2026-10-08

## Goal

The inbox works like WhatsApp for agents: compact bubbles, WhatsApp's
wallpaper, Clear chat / Delete chat / Block, and a menu on each message with
Reply, Copy, React, Forward, Pin, Star and Delete, plus a scroll-to-latest
button that counts new messages.

## Non-goals

- Editing or unsending a sent message: the Cloud API has neither (edit and
  revoke exist only as webhooks for the WhatsApp Business app).
- Report and "Ask Meta AI": not offered to businesses.
- Permanently erasing a customer's data. Delete hides; erasure on request
  would be its own audited feature.

## Done (shipping with this task's first deploy)

- Bubbles 29px for one line (were 54px: preflight is off, so `<p>` kept 1em
  margins); clock on the last line's baseline (measured, 0px off).
- Original doodle wallpaper (`scripts/gen-chat-doodles.mjs`), tinted per theme.
- Clear chat, Delete chat, Block, Unblock: UI, API, D1 migration 0011,
  Supabase permissions `inbox.delete` and `inbox.block`.
- API only, no controls yet: reply with quote (`replyTo`), reactions, forward,
  pin (3 per chat), personal stars, delete one message; the webhook stores
  `context_wamid` for customer replies and reactions.

## Still to do

- [ ] Hover chevron on each bubble opening the message menu (quick reactions
      row; Reply, Copy, Forward, Pin/Unpin, Star/Unstar, Delete).
- [ ] Reply bar above the composer, and the quoted block inside bubbles
      (hide it when the quoted message is not in the loaded thread, e.g. a
      campaign template a button tap answers).
- [ ] Reaction badges under bubbles: fold `type = 'reaction'` rows onto their
      `context_wamid`, latest per side wins, `''` removes; rows without a
      context (before migration 0011) keep showing as before.
- [ ] Pinned bar under the header; "Starred messages" filter.
- [ ] Forward dialog: pick up to 5 chats, one API call each, closed-window and
      blocked chats disabled.
- [ ] Scroll-to-latest: WhatsApp look and an unread count while scrolled up.
- [ ] Handle `message:hidden` broadcasts in the client.
- [ ] Optional: drift check against Meta's block list (`GET block_users`).

## Verification so far

- `npm run check` on the rebased branch.
- Local end-to-end API test (wrangler getPlatformProxy: real local D1 with all
  migrations, local R2, Supabase and Meta mocked): 47 checks covering allowed,
  denied, malformed, Meta-refused and duplicate cases for every new route and
  the webhook insert.
- Headless Chrome on `scripts/preview/whatsapp-inbox.html`: light/dark,
  desktop/mobile, menu, dialogs, blocked bar, permission-less agent.
- Not verified: real Meta block/unblock and reactions (needs a live number).

## Rollout order

1. D1: `npx wrangler d1 migrations apply dikho-whatsapp --remote -c wrangler.api.jsonc`
   BEFORE the API deploy (the list, thread and webhook insert read the new
   columns; without them the inbox fails and inbound messages park as failed).
2. Supabase: `20261007120000_inbox_chat_permissions.sql` (rename the file to
   the version MCP records).
3. `npm run deploy:api` from a tree that contains everything already live.
4. Push to `main` for the SPA.
