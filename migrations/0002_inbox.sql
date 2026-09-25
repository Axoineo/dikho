-- Dikho WhatsApp — two-way conversational inbox.
-- Apply: npx wrangler d1 migrations apply dikho-whatsapp --remote -c wrangler.api.jsonc
--
-- Additive and safe to apply while the existing campaign flow is live: the new
-- columns default to what campaign rows already are (outbound / text), and the
-- new `conversations` table is only written by the inbound webhook + reply route.

-- One thread per customer number. `phone` is the natural key — webhooks arrive
-- by phone/wamid — so it is UNIQUE and every message joins back through it.
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL UNIQUE,             -- E.164 digits, e.g. 919876543210
  wa_name TEXT,                           -- WhatsApp profile name from the webhook
  last_message_at TEXT,                   -- ISO; drives chat-list ordering
  last_message_preview TEXT,              -- short text for the list row
  last_message_direction TEXT,            -- inbound | outbound
  last_inbound_at TEXT,                   -- ISO; drives the 24-hour session window
  unread_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',    -- open | closed
  assigned_to TEXT,                       -- Supabase user id (optional routing)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at DESC);

-- Extend the existing campaign-oriented `messages` table so it also carries
-- conversational and inbound messages. Existing rows keep direction='outbound'
-- and type='text', which is exactly what they already were.
ALTER TABLE messages ADD COLUMN conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound';  -- inbound | outbound
ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text';           -- text | image | document | audio | video | sticker | template
ALTER TABLE messages ADD COLUMN body TEXT;              -- text content or media caption
ALTER TABLE messages ADD COLUMN media_id TEXT;          -- Meta media id (transient; inbound only)
ALTER TABLE messages ADD COLUMN media_url TEXT;         -- OUR persistent URL (served from R2, never Meta's)
ALTER TABLE messages ADD COLUMN media_mime TEXT;
ALTER TABLE messages ADD COLUMN media_filename TEXT;
ALTER TABLE messages ADD COLUMN media_status TEXT;      -- NULL | pending | ready | failed
ALTER TABLE messages ADD COLUMN wa_timestamp TEXT;      -- message time reported by Meta
ALTER TABLE messages ADD COLUMN sender TEXT;            -- outbound: agent's Supabase user id

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
