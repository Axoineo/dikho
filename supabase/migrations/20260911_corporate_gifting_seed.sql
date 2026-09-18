INSERT INTO catalogues (name, slug, description, active)
VALUES ('Corporate Gifting', 'corporategifting', 'Dikho Corporate Gifting', true)
ON CONFLICT (slug) DO NOTHING;
