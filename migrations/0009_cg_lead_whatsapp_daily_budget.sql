-- Global daily ceiling on WhatsApp sends triggered by the public, unauthenticated
-- corporate-gifting lead form (POST /api/public/cg-lead — no login required to
-- reach it, gated only by Turnstile).
--
-- Same reasoning as gstn_lookup_budget (migration 0007): Turnstile raises the
-- cost of automating this route but does not cap volume, and a per-IP limiter
-- is known-weak in this codebase (see wrangler.api.jsonc — Cloudflare counts
-- per colo and documents the binding as "intentionally... not... an accurate
-- accounting system"). Unlike a GSTIN lookup, an unbounded send here is not
-- free: each one is a billed Meta conversation AND lands in some stranger's
-- inbox as a business-initiated message (the form never verifies the visitor
-- owns the number they typed), so an attacker cycling through arbitrary phone
-- numbers both costs money and risks the WABA's quality rating / messaging
-- limits with Meta if recipients report it. The per-(phone, template) cooldown
-- in migration 0008 stops repeat messaging of the SAME number; it does nothing
-- to bound how many DISTINCT numbers get messaged in one day. A capped GLOBAL
-- counter is what bounds that, because it survives both IP rotation and
-- cooldown evasion via a fresh number each time.
--
-- Same bounded-write-cost shape as 0007 and 0008: the UPDATE is guarded on
-- `sent < cap`, so once the ceiling is hit the statement writes nothing —
-- see consumeCgLeadWhatsappBudget in src/api/routes/public/index.js.
CREATE TABLE IF NOT EXISTS cg_lead_whatsapp_budget (
  day TEXT PRIMARY KEY,   -- UTC date, YYYY-MM-DD
  sent INTEGER NOT NULL DEFAULT 0
);
