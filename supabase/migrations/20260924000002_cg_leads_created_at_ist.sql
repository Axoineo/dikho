-- Record created_at in India Standard Time (Asia/Kolkata) instead of UTC.
-- Supabase stores/shows timestamptz in UTC, which is up to 5h30m behind IST,
-- so early-morning IST submissions were showing the previous day. Storing the
-- IST wall-clock time makes the dashboard date match the day the lead submitted.
-- Note: this makes created_at read as IST rather than a true UTC instant.

ALTER TABLE cg_leads
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata');
