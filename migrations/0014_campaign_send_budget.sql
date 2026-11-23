-- Daily ceiling, across all staff, on WhatsApp campaign messages (pre-launch
-- audit 3.4, 2026-11-22). Each campaign was capped at 2,000 recipients, but
-- nothing limited how many campaigns went out in a day, so one compromised or
-- careless login could spend money and the number's quality rating many times
-- over. /api/campaigns/send, /send-batch and /:id/retry reserve every recipient
-- here before calling Meta (src/api/services/whatsapp/campaignBudget.js).
-- Recipients the day's ceiling cannot cover are not sent: the campaign stops the
-- way a Meta block stops it, they stay in "Not received", and it can be resumed
-- the next UTC day. One row per day, so the counter's own writes stay tiny.
CREATE TABLE IF NOT EXISTS campaign_send_budget (
  day TEXT PRIMARY KEY,   -- UTC date, YYYY-MM-DD
  sent INTEGER NOT NULL DEFAULT 0
);
