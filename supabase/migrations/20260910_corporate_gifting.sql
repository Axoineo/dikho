CREATE TABLE IF NOT EXISTS catalogues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  category text,
  cover_image text,
  active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS catalogue_files (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid references catalogues(id) on delete cascade,
  name text not null,
  description text,
  category text,
  s3_key text not null,
  file_size bigint,
  type text default 'file', -- 'file', 'complete'
  active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS catalogue_leads (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid references catalogues(id) on delete cascade,
  name text not null,
  company_name text,
  email text,
  mobile text,
  city text,
  created_at timestamptz default now()
);

ALTER TABLE catalogues ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Catalogues are viewable by everyone." ON catalogues;
CREATE POLICY "Catalogues are viewable by everyone." ON catalogues FOR SELECT USING (active = true);

DROP POLICY IF EXISTS "Catalogue files are viewable by everyone." ON catalogue_files;
CREATE POLICY "Catalogue files are viewable by everyone." ON catalogue_files FOR SELECT USING (active = true);

DROP POLICY IF EXISTS "Anyone can insert leads." ON catalogue_leads;
CREATE POLICY "Anyone can insert leads." ON catalogue_leads FOR INSERT WITH CHECK (true);
