-- Inbox actions: clear chat, delete chat, block, and per-message reply,
-- react, pin, star and delete.
-- Apply BEFORE deploying the API that reads these columns:
--   npx wrangler d1 migrations apply dikho-whatsapp --remote -c wrangler.api.jsonc
--
-- Clearing and deleting HIDE history; they do not remove rows. The thread is
-- a business record shared by every agent, and the customer keeps their own
-- copy on WhatsApp either way, so the useful part of "delete" is getting the
-- chat out of the team's way. Hiding is also the only version that fits the
-- D1 free tier: one UPDATE here, where deleting a long thread's rows would
-- cost thousands of row writes against the 100k/day cap (messages carries
-- several indexes, and every row delete updates each of them).
--
-- Messages with id <= cleared_through_id are hidden from the thread. AUTO-
-- INCREMENT ids only grow, so anything that arrives after a clear shows up,
-- including a late webhook for a message the customer sent before it. That is
-- what WhatsApp itself does. Comparing timestamps instead would hide it,
-- because inbound rows carry the customer's send time, not ours.
--
-- Delete chat is a clear plus status = 'deleted', which the chat list already
-- filters out (it lists status = 'open'). The next inbound message reopens the
-- conversation through the webhook's upsert, with only the new messages
-- visible, as WhatsApp does.
--
-- Restoring is a manual UPDATE (cleared_through_id = 0, status = 'open', or
-- hidden_at = NULL for one message); the dashboard does not offer it.
ALTER TABLE conversations ADD COLUMN cleared_through_id INTEGER NOT NULL DEFAULT 0;

-- ISO-8601 time the number was added to Meta's block list from the inbox, or
-- NULL. Mirrors Meta's state as far as this dashboard knows it: a block or
-- unblock made in another tool is not reflected here.
ALTER TABLE conversations ADD COLUMN blocked_at TEXT;

-- The wamid this message refers to: the message a reply quotes (Meta's
-- `context.id`, in both directions), or the message a reaction is on. A
-- reaction stays a row of its own, append-only like every other webhook
-- write; the dashboard folds the latest one per side onto its target.
ALTER TABLE messages ADD COLUMN context_wamid TEXT;

-- Pinned for the whole team. The Cloud API has no pinning, so the customer
-- never sees these; they are the team's bookmarks on a thread.
ALTER TABLE messages ADD COLUMN pinned_at TEXT;
ALTER TABLE messages ADD COLUMN pinned_by TEXT;

-- "Delete" on one message: hidden from the thread for every agent. The
-- Cloud API cannot unsend, so the customer keeps it.
ALTER TABLE messages ADD COLUMN hidden_at TEXT;
ALTER TABLE messages ADD COLUMN hidden_by TEXT;

-- Stars are personal, as in WhatsApp: each agent keeps their own.
CREATE TABLE IF NOT EXISTS message_stars (
  message_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,            -- Supabase user id
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- Who cleared, deleted, blocked or unblocked a chat or deleted a message, and
-- when. The state lives on `conversations` and `messages`; this is the
-- history behind it, because "where did this go?" has to have an answer.
-- Append-only, one row per action, so the cost is a single row write each.
-- No foreign keys on purpose: the history should outlive anything that ever
-- removes the rows it points at.
CREATE TABLE IF NOT EXISTS conversation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  action TEXT NOT NULL,             -- cleared | deleted | blocked | unblocked | message_deleted
  actor TEXT,                       -- Supabase user id of the staff member
  message_id INTEGER,               -- cleared | deleted: the newest id hidden;
                                    -- message_deleted: the message hidden
  created_at TEXT NOT NULL          -- toISOString(), like every inbox row
);

CREATE INDEX IF NOT EXISTS idx_conversation_events_conversation
  ON conversation_events(conversation_id, id);
