-- Migration: new-device tracking tables for Dikho SO-PO
-- Created: 2026-08-21
--
-- user_devices  — one row per (user, device) pair; device_id is a random UUID
--                stored in the browser's localStorage (no fingerprinting).
-- login_events  — append-only log of every sign-in, flagging new devices.
--
-- Both tables use RLS. Writes are performed by the device-check Edge Function
-- via the service role key (which bypasses RLS), so no INSERT policies are
-- needed on these tables.

-- ── user_devices ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_devices (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id  text        NOT NULL,
  label      text,
  first_seen timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_devices_unique UNIQUE (user_id, device_id)
);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

-- Users may read their own device records
CREATE POLICY "user_devices_owner_select"
  ON public.user_devices
  FOR SELECT
  USING (auth.uid() = user_id);

-- No direct INSERT/UPDATE/DELETE by end-users;
-- the Edge Function writes via the service role.

-- ── login_events ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.login_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id  text        NOT NULL,
  is_new     boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;

-- Users may read their own login history
CREATE POLICY "login_events_owner_select"
  ON public.login_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- No direct INSERT/UPDATE/DELETE by end-users.
