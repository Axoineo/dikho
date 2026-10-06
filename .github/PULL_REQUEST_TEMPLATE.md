## What changed

<!-- Describe the outcome and affected users/workflows. Do not paste secrets,
production records, provider payloads or private resource identifiers. -->

## Trust boundaries and risk

<!-- State affected roles, public/authenticated routes, databases, Storage,
external providers, paid/sending operations and failure behavior. Use "none"
only after checking. -->

## Verification

<!-- List exact commands and manual scenarios. Distinguish passed, failed, not
run and not configured. A passing npm run check does not verify RLS or UI. -->

- [ ] `npm run check`
- [ ] `npm audit --omit=dev` when dependencies or the lockfile changed
- [ ] Allowed and denied cases tested at the enforcing layer
- [ ] Mobile/desktop and light/dark checked for UI changes
- [ ] RLS/Storage tested with real database roles when policies changed

## Rollout and rollback

<!-- Every push/merge to main deploys the production SPA. Identify ordering for
API, database, Edge Function, provider and Pages changes. Link a task brief or
runbook for risky rollouts. -->

## Review checklist

- [ ] The change is focused and unrelated user work is preserved.
- [ ] No credential, OTP, signed URL, production personal data or private
      resource identifier was added to code, fixtures, logs, screenshots or
      documentation.
- [ ] Authentication is not being used as a substitute for authorization.
- [ ] New inputs, uploads, imports and provider responses have explicit limits.
- [ ] Paid or message-sending work is idempotent and globally budgeted.
- [ ] Financial records retain reconciliation and correction history.
- [ ] Migrations are forward-only and do not edit shared applied migrations.
- [ ] Documentation and `CHANGELOG.md` reflect the final behavior.
- [ ] Remaining gaps and unrun verification are stated plainly.
