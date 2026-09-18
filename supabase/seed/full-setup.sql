-- 1. Create the tables if they don't exist
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
  type text default 'file',
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

-- 2. Enable RLS
ALTER TABLE catalogues ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_leads ENABLE ROW LEVEL SECURITY;

-- 3. Create policies (Drop first if they exist to avoid errors)
DROP POLICY IF EXISTS "Catalogues are viewable by everyone." ON catalogues;
CREATE POLICY "Catalogues are viewable by everyone." ON catalogues FOR SELECT USING (active = true);

DROP POLICY IF EXISTS "Catalogue files are viewable by everyone." ON catalogue_files;
CREATE POLICY "Catalogue files are viewable by everyone." ON catalogue_files FOR SELECT USING (active = true);

DROP POLICY IF EXISTS "Anyone can insert leads." ON catalogue_leads;
CREATE POLICY "Anyone can insert leads." ON catalogue_leads FOR INSERT WITH CHECK (true);

-- 4. Grant access to anonymous users (Supabase API)
GRANT SELECT ON catalogues TO anon;
GRANT SELECT ON catalogue_files TO anon;
GRANT INSERT ON catalogue_leads TO anon;

-- 5. Insert the catalogue and files
WITH new_catalogue AS (
  INSERT INTO catalogues (name, slug, description, active)
  VALUES ('Corporate Gifting', 'corporategifting', 'Premium Corporate Gifting Solutions', true)
  ON CONFLICT (slug) DO UPDATE SET active = true
  RETURNING id
)
INSERT INTO catalogue_files (catalogue_id, name, category, s3_key, type, sort_order)
SELECT 
  id as catalogue_id,
  file_data.name,
  file_data.category,
  file_data.s3_key,
  file_data.type,
  file_data.sort_order
FROM new_catalogue
CROSS JOIN (
  VALUES 
    ('Diaries Collection', 'Diaries', 'Dikho - Corporate Gifting/diaries.pdf', 'file', 1),
    ('Premium Pens', 'Pens', 'Dikho - Corporate Gifting/pens.pdf', 'file', 2),
    ('Drinkware & Bottles', 'Drinkware', 'Dikho - Corporate Gifting/drinkware.pdf', 'file', 3),
    ('Complete Collection', 'All', 'Dikho - Corporate Gifting/complete-catalogue.pdf', 'complete', 99)
) AS file_data(name, category, s3_key, type, sort_order);
