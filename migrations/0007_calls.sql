-- Dikho WhatsApp — inbound voice calls (WhatsApp Business Calling API).
-- Apply: npx wrangler d1 migrations apply dikho-whatsapp --remote -c wrangler.api.jsonc
--
-- Additive. Nothing here is written until the app is subscribed to the `calls`
-- webhook field in the Meta App Dashboard, so applying it early is harmless.

-- One row per call. `wacid` is Meta's call id (shaped `wacid.ABGG...`) and is
-- the natural key: the connect webhook, every agent action, and the terminate
-- webhook all reference it, and its UNIQUE constraint is what makes a
-- redelivered webhook — or two agent tabs answering at once — idempotent.
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wacid TEXT NOT NULL UNIQUE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  phone TEXT,                             -- E.164 digits of the customer
  wa_name TEXT,                           -- WhatsApp profile name at call time
  direction TEXT NOT NULL DEFAULT 'inbound',  -- inbound | outbound
  -- ringing    : connect webhook seen, nobody has claimed it yet
  -- connecting : an agent claimed it (pre_accept/accept sent to Meta)
  -- active     : accept returned 200; media is flowing
  -- completed  : answered, then ended
  -- missed     : never answered
  -- rejected   : an agent declined it
  -- failed     : Meta reported the call as Failed
  status TEXT NOT NULL DEFAULT 'ringing',
  answered_by TEXT,                       -- Supabase user id of the agent who claimed it
  ring_at TEXT,                           -- ISO; connect webhook timestamp
  answered_at TEXT,                       -- ISO; set on the winning claim
  ended_at TEXT,
  duration_seconds INTEGER,               -- as reported by Meta on terminate
  end_reason TEXT,                        -- Meta's terminate `status`, lowercased
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calls_conversation ON calls(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_phone ON calls(phone, created_at DESC);

-- A finished call also lands in the thread as a `type='call'` message row so it
-- shows up in the conversation timeline alongside texts and media. That row
-- reuses meta_message_id to carry the wacid, which the existing UNIQUE index
-- turns into free idempotency (wacid and wamid namespaces never collide).
