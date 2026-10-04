# Incident Response

Use this runbook for suspected credential exposure, unauthorized access,
incorrect financial changes, abusive public intake, unintended message sends,
private-file disclosure or provider compromise.

## Priorities

1. Protect people and stop continuing harm.
2. Preserve useful evidence without copying sensitive payloads into tickets or
   chat.
3. Restore a safe service with the smallest reversible change.
4. Determine impact, notify through the approved process and prevent recurrence.

## Triage

- Record detection time, reporter, affected environment and symptoms.
- Assign an incident commander and a private coordination channel.
- Classify the affected boundary: browser, SPA (Cloudflare Pages), API Worker, Supabase,
  D1/R2, Meta/WhatsApp or another provider.
- Determine whether the event is active and whether credentials, personal data,
  documents, financial records, messages or paid quota may be affected.
- Use sanitized event IDs and time ranges. Do not paste tokens, OTPs, signed
  URLs, message bodies, documents or complete webhook payloads.

## Containment

- Disable the smallest affected route, integration, scheduled job or credential.
- Preserve idempotency and audit records; do not delete suspected evidence.
- For a disclosed credential, follow [credential rotation](credential-rotation.md).
- For unsafe application behavior, follow [rollback](rollback.md) or deploy a
  reviewed containment patch.
- If public abuse can spend money or send messages, lower or exhaust the global
  budget before relying on per-client rate limits.

Do not weaken authentication, authorization, RLS, Storage policies or signature
verification to restore availability.

## Investigation

- Establish the first known and last known affected times.
- Review sanitized Cloudflare, Supabase and provider audit logs with authorized
  access.
- Identify affected identities, objects and operations without exporting more
  data than needed.
- Check replay/idempotency records for duplicate sends or writes.
- Determine root cause, entry point, privileges obtained and persistence.
- Record which conclusions are confirmed and which remain assumptions.

## Recovery

- Patch the root cause and add a regression check for the failed boundary.
- Validate denied, malformed, expired, replayed and duplicate cases as relevant.
- Restore integrations gradually and watch sanitized error, budget and delivery
  signals.
- Reconcile financial or messaging side effects through an auditable correction
  workflow; do not silently rewrite issued records.

## Closure

- Complete required contractual, legal and customer notification with the
  authorized owner.
- Document the timeline, impact, decisions and follow-up owners in the private
  incident system.
- Add only non-sensitive architectural lessons, invariant changes or ADRs to
  this repository.
- Confirm temporary access, logging and containment settings were removed.
