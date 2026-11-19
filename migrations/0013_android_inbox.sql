-- For the Android app's native inbox and Device Contacts.
--
-- The chat list now pages by (last_message_at, id) among open chats. Each page
-- reads only the rows it returns, so a list of thousands costs the same as one
-- of dozens. Without this index the same query still answers, by scanning.
CREATE INDEX IF NOT EXISTS idx_conversations_open_recent
  ON conversations(status, last_message_at DESC, id DESC);

-- The unread badge counts open chats with unread messages. A partial index, so
-- the count touches only those rows however large the inbox grows.
CREATE INDEX IF NOT EXISTS idx_conversations_unread
  ON conversations(status) WHERE unread_count > 0;

-- Global daily ceiling on templates sent to a phone number from the app. Each is
-- a billed Meta conversation to a number the CRM may never have seen, and the
-- two-minute duplicate check only stops repeats to the same number. Same bounded
-- write shape as migrations 0007 to 0009: the update is guarded on `sent < cap`,
-- so reaching the ceiling writes nothing.
CREATE TABLE IF NOT EXISTS direct_template_budget (
  day TEXT PRIMARY KEY,   -- UTC date, YYYY-MM-DD
  sent INTEGER NOT NULL DEFAULT 0
);

-- One id per press of Send on a campaign. A retry after a lost response finds the
-- campaign already there instead of creating a second one and messaging everyone
-- twice. NULL for older rows and older clients: SQLite treats NULLs as distinct.
ALTER TABLE campaigns ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_request ON campaigns(request_id);

-- WhatsApp analytics (src/api/services/whatsapp/analytics.js). Counting by day reads
-- messages by when they were created, which had no index: every count scanned the
-- whole table.
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- Day counts and Meta's figures, kept so a dashboard view never recounts what cannot
-- have changed. A settled day is counted once; recent days and Meta's figures expire
-- after minutes. Everything here can be deleted at any time and is rebuilt on demand.
CREATE TABLE IF NOT EXISTS analytics_cache (
  key TEXT PRIMARY KEY,        -- 'day:YYYY-MM-DD', 'live:30', 'meta:30:YYYY-MM-DD'
  body TEXT NOT NULL,          -- JSON
  computed_at TEXT NOT NULL    -- ISO time
);
