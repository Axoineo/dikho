-- Dikho WhatsApp — personalized (variable) campaigns.
-- Apply: npx wrangler d1 migrations apply dikho-whatsapp --remote -c wrangler.api.jsonc
--
-- Additive and safe to apply while the campaign flow is live. Both columns are
-- nullable JSON blobs; existing static campaigns and contacts keep working with
-- them unset.

-- Every column from the uploaded list, keyed by its original header, so
-- template variables like {{name}} / {{greeting}} can be resolved per contact.
ALTER TABLE contacts ADD COLUMN attributes TEXT;   -- JSON object, original keys

-- The token -> source map that was used for a send, kept for the record.
ALTER TABLE campaigns ADD COLUMN variables TEXT;   -- JSON object
