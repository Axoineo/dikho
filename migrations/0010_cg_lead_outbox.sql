-- Deferred send queue for the corporate-gifting confirmation.
--
-- The message is no longer sent at the moment the form is submitted: it is
-- scheduled WHATSAPP_CG_LEAD_DELAY_MINUTES (7) minutes later, so the lead has
-- a beat before the WhatsApp arrives.
--
-- Why a table and a cron rather than a timer: a Worker cannot wait 7 minutes.
-- `waitUntil` keeps the request context alive only for seconds after the
-- response, and a `setTimeout` that long is killed well before it fires — so
-- the intent has to be persisted somewhere a later invocation can pick it up.
-- The Worker already runs a cron (wrangler.api.jsonc) for the delivery-receipt
-- reconciler, so this reuses that mechanism with a second, every-minute
-- schedule; `src/api/worker.js` routes the two apart on `event.cron`.
--
-- Rows are terminal once dispatched: pending -> sending -> sent | failed |
-- skipped. 'sending' exists so two overlapping cron runs cannot both claim the
-- same row (the claim is an atomic guarded UPDATE ... RETURNING, the same
-- pattern claimRecipients uses in routes/campaigns/index.js).
--
-- This table does NOT enforce the one-message-per-number-per-week rule —
-- template_send_cooldowns (migration 0008) still does, claimed at SEND time
-- rather than enqueue time, so a message that never actually went out cannot
-- consume a number's weekly slot.
CREATE TABLE IF NOT EXISTS cg_lead_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,              -- E.164 digits, e.g. 919876543210
  name TEXT NOT NULL,               -- fills the template's first variable
  template_name TEXT NOT NULL,
  -- SQLite's own `datetime('now', '+N minutes')` format throughout, compared
  -- against `datetime('now')`. Deliberately NOT a JS toISOString(): migration
  -- 0002's notes record how mixing the two formats in `messages.created_at`
  -- silently mis-sorts, because SQLite compares them as TEXT and ' ' sorts
  -- before 'T'. Everything here is written and read by SQLite alone.
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed | skipped
  skip_reason TEXT,                 -- why a 'skipped' row was not sent
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The dispatcher's only hot query: due rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_cg_lead_outbox_due ON cg_lead_outbox(status, scheduled_at);

-- Enqueue-time dedupe looks up live rows for a number.
CREATE INDEX IF NOT EXISTS idx_cg_lead_outbox_phone ON cg_lead_outbox(phone, template_name, status);
