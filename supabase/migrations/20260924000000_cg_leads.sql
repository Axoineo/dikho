-- Corporate Gifting lead-capture table for https://manage.dikho.in/corporategifting
-- Columns mirror the public inquiry form: Company name, Your Name, Country code,
-- Mobile number, Email ID, City/Location.

CREATE TABLE IF NOT EXISTS cg_leads (
  id uuid primary key default gen_random_uuid(),
  company_name text,          -- Company name
  name text not null,         -- Your Name
  country_code text,          -- Country code, e.g. '+91'
  mobile text,                -- Mobile number
  email text,                 -- Email ID
  city text,                  -- City/Location
  created_at timestamptz default now()
);

CREATE INDEX IF NOT EXISTS idx_cg_leads_created ON cg_leads(created_at DESC);

-- Public form writes leads, so allow anonymous INSERT (matches catalogue_leads).
ALTER TABLE cg_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert cg leads." ON cg_leads;
CREATE POLICY "Anyone can insert cg leads." ON cg_leads FOR INSERT WITH CHECK (true);
