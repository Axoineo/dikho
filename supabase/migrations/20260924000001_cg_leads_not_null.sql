-- Tighten cg_leads: every field is required except Email ID.
-- The public corporate-gifting form validates all of these as mandatory
-- (only email is optional), so enforce it at the database level too.
-- (name is already NOT NULL from the initial migration.)

ALTER TABLE cg_leads
  ALTER COLUMN company_name SET NOT NULL,
  ALTER COLUMN country_code SET NOT NULL,
  ALTER COLUMN mobile       SET NOT NULL,
  ALTER COLUMN city         SET NOT NULL;
