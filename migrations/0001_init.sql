-- Dikho WhatsApp Marketing — D1 schema.
-- Apply with: npx wrangler d1 execute dikho-whatsapp --remote --file=migrations/0001_init.sql
--
-- Phase constraint: the only approved template is STATIC (no variables), so
-- there is no variable-mapping table here. When variable templates land, add
-- a `campaign_variables` table rather than widening `campaigns`.

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT NOT NULL UNIQUE,        -- E.164 digits, e.g. 919876543210
  email TEXT,
  company TEXT,
  opted_out INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | import
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts(created_at DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | sending | completed | failed
  total_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,                   -- Supabase user id of the sender
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaigns_created ON campaigns(created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,               -- denormalised: webhooks arrive by phone/wamid
  meta_message_id TEXT UNIQUE,       -- wamid returned by Meta on send
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | delivered | read | failed
  error_code TEXT,
  error_message TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_meta_id ON messages(meta_message_id);

-- Idempotency ledger. Meta retries webhook deliveries, so every sub-event is
-- keyed and inserted with ON CONFLICT DO NOTHING before any state changes.
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,          -- status | message | other
  idempotency_key TEXT NOT NULL UNIQUE, -- `${wamid}:${status}` for receipts
  payload TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending', -- pending | processed | failed
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(processing_status);
