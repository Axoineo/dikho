-- Fixes a race that let two overlapping requests (e.g. the frontend replaying
-- a batch after a dropped connection, or two retry clicks) both send to and
-- log the same contact within one campaign — confirmed in production on
-- 2026-09-25 (3 contacts on campaign_proposal_cg_diwali each got two real
-- WhatsApp deliveries). Apply:
--   npx wrangler d1 migrations apply dikho-whatsapp --remote -c wrangler.api.jsonc

-- One-time cleanup: collapse any existing duplicate (campaign_id, contact_id)
-- rows down to the earliest one before the constraint below can be added.
-- Inbox messages (campaign_id IS NULL) are untouched — SQLite/D1 already
-- treats NULL as distinct per-row in a unique index, so they were never at
-- risk and don't need cleaning.
DELETE FROM messages
WHERE campaign_id IS NOT NULL
  AND contact_id IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id) FROM messages
    WHERE campaign_id IS NOT NULL AND contact_id IS NOT NULL
    GROUP BY campaign_id, contact_id
  );

-- A contact can only have one message row per campaign from here on. The
-- send path now claims a row (INSERT ... ON CONFLICT DO NOTHING / UPDATE
-- ... WHERE status='failed', both with RETURNING) before ever calling Meta,
-- so a replayed/overlapping request only ever "wins" the claim once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_campaign_contact
  ON messages(campaign_id, contact_id);
