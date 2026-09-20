-- Phase 3 blueprint only — not wired to any D1 binding yet.
-- Apply later with: wrangler d1 execute <db-name> --file=migrations/0001_init.sql

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT NOT NULL UNIQUE,        -- E.164, e.g. +919876543210
  email TEXT,
  company TEXT,
  tags TEXT,                         -- JSON array, e.g. ["vip","mumbai"]
  opted_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_contacts_phone ON contacts(phone);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_name TEXT NOT NULL,       -- Meta template name
  template_language TEXT NOT NULL DEFAULT 'en',
  template_components TEXT,          -- JSON: header/body/button variable mapping
  status TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | sending | completed | failed
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE campaign_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | queued | sent | failed | skipped
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX idx_campaign_contacts_campaign ON campaign_contacts(campaign_id);
CREATE INDEX idx_campaign_contacts_contact ON campaign_contacts(contact_id);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  meta_message_id TEXT UNIQUE,       -- wamid returned by Meta on send
  direction TEXT NOT NULL,           -- outbound | inbound
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | delivered | read | failed
  error_code TEXT,
  error_message TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_campaign ON messages(campaign_id);
CREATE INDEX idx_messages_contact ON messages(contact_id);
CREATE INDEX idx_messages_meta_id ON messages(meta_message_id);

CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,          -- message | status | other
  idempotency_key TEXT NOT NULL UNIQUE, -- wamid, or `${wamid}:${status}` for status updates
  payload TEXT NOT NULL,             -- raw JSON sub-event, for replay/debugging
  processing_status TEXT NOT NULL DEFAULT 'pending', -- pending | processed | failed
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE INDEX idx_webhook_events_status ON webhook_events(processing_status);
