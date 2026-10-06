# Supabase Instructions

These instructions extend the repository root `AGENTS.md` for
`supabase/`.

## Migrations

- Treat deployed migrations as immutable; add a new forward migration.
- Confirm migration ordering and document rollout/rollback when application code
  and permissions are coupled.
- Do not use imported remote-schema snapshots as ordinary incremental
  migrations.
- Back up before destructive production changes.
- A migration applied through the Supabase MCP `apply_migration` tool is
  recorded under the tool's own version timestamp, not the local filename.
  Rename the local file to the recorded version, or Supabase's GitHub
  integration fails with "Remote migration versions not found in local
  migrations directory". Never edit `schema_migrations` to match a filename.

## RLS and grants

- Enable RLS before exposing a table through PostgREST.
- Prefer organization, owner and role predicates over unconditional
  `USING (true)` or `WITH CHECK (true)`.
- Test allowed and denied operations as both `anon` and `authenticated`.
- Revoke direct anonymous table/RPC access when a verified Worker path is the
  intended boundary.
- Every new `public` table needs the restrictive `staff members only` policy
  (see `docs/DATABASE.md`); a signed-in session alone is not staff.
- Security-definer functions callable by `authenticated` must check
  `public.is_staff()` themselves.
- Inspect effective production policies after deployment.

## Security-definer functions

- Set a safe `search_path` and qualify all referenced objects.
- Whitelist input columns and assign security-sensitive defaults server-side.
- Revoke implicit `PUBLIC` execution and grant only named roles.
- Check identity, organization and role inside sensitive functions.

## Storage

- A private bucket does not make broad object policies safe.
- Scope read/write/delete by organization, record, path and role.
- Do not add new anonymous object mutation. Public uploads go through a
  verified Worker route that writes with the service role.
- Signed URLs are bearer capabilities and must not be logged or stored
  permanently.

## Edge Functions

- Validate the caller JWT before service-role operations.
- Keep service-role and provider credentials server-side.
- Use exact origin allowlists, sanitized logs and bounded external requests.
