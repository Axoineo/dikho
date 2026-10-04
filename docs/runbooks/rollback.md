# Application and Migration Rollback

Rollback should restore safe behavior without reopening a known vulnerability
or destroying evidence. Confirm the target environment and obtain the required
production approval before acting.

## Application code

1. Identify the last reviewed compatible release for the affected component.
2. Check database, binding and environment compatibility before deploying it.
3. Roll back only the affected component when possible. For the SPA, roll
   back to a previous production deployment in Cloudflare Pages, then revert
   the commit on `main` so the next push does not redeploy it. For the API
   Worker, use `wrangler rollback` or redeploy the last good commit. For the
   Edge Function, redeploy the last good version.
4. Run the relevant smoke tests from [Deployment](../DEPLOYMENT.md).
5. Monitor sanitized error and security signals until stable.

Do not roll back to a version that expects broader public grants, lacks webhook
verification or can repeat paid/send operations. Disable the affected feature
if no safe prior version is compatible.

## Database and policy changes

- Never edit or delete a migration already applied to a shared environment.
- Use a reviewed forward migration to restore compatible behavior.
- Back up before destructive correction and verify the target project/database.
- Test both allowed and denied RLS/Storage behavior after the change.
- Preserve audit, reconciliation and idempotency records.
- Do not restore anonymous or bucket-wide access merely to make a client work.

For data restoration, use the provider's approved backup procedure and rehearse
it outside production. This repository does not yet define environment-specific
recovery objectives or a complete backup/restore procedure.

## Configuration and credentials

- Revert non-secret configuration through reviewed versioned configuration.
- Never retrieve and print a secret to compare versions.
- If a credential may have been exposed, rotate it using
  [Credential rotation](credential-rotation.md) instead of restoring it.

## Completion record

Record the reason, approved owner, versions/migrations involved, start/end time,
checks performed and remaining risks in the private operational record. Update
repository documentation only with non-sensitive lessons that remain useful.
