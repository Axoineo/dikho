-- Dikho WhatsApp inbox — UI pass support.
-- Apply: npx wrangler d1 migrations apply dikho-whatsapp --remote -c wrangler.api.jsonc
--
-- Additive. `avatar_url` backs the agent-uploaded contact photo (Cloud API does
-- not provide WhatsApp profile pictures). `media_size` backs the file-size label
-- shown on document/media bubbles.

ALTER TABLE contacts ADD COLUMN avatar_url TEXT;   -- agent-set photo (served from R2)
ALTER TABLE messages ADD COLUMN media_size INTEGER; -- bytes, for the size label
