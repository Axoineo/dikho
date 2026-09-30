-- Per-(phone, template) send cooldown for automated single-recipient sends
-- (e.g. the corporate-gifting lead form's confirmation message), so the same
-- number is never messaged twice within a rolling window no matter how many
-- times it triggers the send.
--
-- Same bounded-write-cost shape as gstn_lookup_budget (migration 0007): the
-- claim is one guarded UPSERT, so a number still inside its cooldown costs
-- zero D1 writes, not just a skipped Meta call. See claimTemplateSend in
-- src/api/routes/public/index.js for the query that relies on this.
CREATE TABLE IF NOT EXISTS template_send_cooldowns (
  phone TEXT NOT NULL,
  template_name TEXT NOT NULL,
  last_sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (phone, template_name)
);
