# Credential Rotation

Use this runbook for scheduled rotation or suspected exposure. Provider consoles
and the private operations inventory are the source of truth for exact secret
names and environments. Never copy values into source, Markdown, issues, chat,
screenshots or command-line arguments.

## Plan

1. Identify the credential owner, consumers, scopes and environments.
2. Decide whether overlap is supported. Prefer create-new, deploy-new, verify,
   then revoke-old when the provider permits it.
3. Prepare a rollback path that does not reveal either credential.
4. For exposure, assume the value is compromised even if it was later deleted
   from Git or logs.

Credential classes include Cloudflare API access, Supabase server credentials,
Meta access/app credentials, webhook signing material, Turnstile secrets, GST
provider keys and optional mail-provider credentials.

## Rotate

- Create or rotate the value in the owning provider using an authorized account.
- Enter it interactively into the destination secret store. Do not embed it in a
  shell command or environment dump.
- Update one environment at a time and deploy only the consumers that require
  the change.
- Verify authentication and one safe test operation. Check that logs show only
  sanitized status and event metadata.
- Revoke the old value after all intended consumers use the new one.

If the provider cannot overlap credentials, schedule a controlled maintenance
window and keep the affected feature fail-closed during the transition.

## Exposure follow-up

- Remove the value from current files and artifacts, but treat rotation as the
  actual remediation.
- Review provider audit logs for unauthorized use from the earliest possible
  exposure time.
- Invalidate derived sessions, signed links or child tokens when applicable.
- Assess whether history rewriting is necessary; coordinate it because it
  disrupts collaborators and does not replace rotation.
- Record owner, time, affected environments and verification in the approved
  private operations system without recording the value.
