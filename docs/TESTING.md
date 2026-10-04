# Testing and Verification Guide

Last reviewed: 2026-10-04

The repository has a small automated test suite for security-critical helpers.
`npm run check` runs lint, those tests, the production build and the
high-signal secret scan. It does not prove route behavior, authorization, RLS or
migration correctness.

## Safe default check

```bash
npm run check
```

Run the dependency advisory check when dependencies or the lockfile change:

```bash
npm audit --omit=dev
```

## Automated tests

`npm test` runs `tests/*.test.js` with Node's built-in test runner. The tests
need no extra dependencies, never touch the network (`fetch` and `Date.now` are
mocked) and generate their keys in memory. CI runs them on Node 20 and 22.

| File | Covers |
| --- | --- |
| `tests/require-auth.test.js` | `requireAuth`: missing or malformed bearer tokens, missing server configuration, rejected upstream sessions, and only identity fields reaching the handler |
| `tests/turnstile.test.js` | Turnstile verification: fail-closed configuration, token bounds, hostname and action checks, upstream, parsing and network failures |
| `tests/webhook-signatures.test.js` | Meta HMAC and Standard Webhooks signatures: raw-body binding, rotated keys, timestamp tolerance and malformed headers |
| `tests/media-ticket.test.js` | Media tickets: expiry, tampering, wrong keys and malformed tickets |

Add new tests in the same style: import the module under test directly, mock
every external call and use obviously synthetic values.

## Legacy probes

Do not run files under `scripts/test/` as an automated suite. They are legacy
manual probes: one expects a local route that no longer represents the current
API, and one reads local Supabase configuration and queries a historical table.
Replace them with isolated tests before connecting them to `npm test` or CI.

## Verification matrix

| Change | Minimum verification |
| --- | --- |
| Documentation | Local links resolve, docs secret scan, `git diff --check` |
| React UI | lint, build, target route, mobile/desktop, light/dark |
| API route | success, missing/invalid auth, forbidden role, malformed input |
| Public endpoint | missing/invalid/replayed verification, abuse/budget behavior |
| Webhook | valid, invalid, stale, duplicate and out-of-order delivery |
| Upload/import | empty, oversized, wrong MIME, bad signature, malformed archive |
| D1 migration | clean apply, existing-data compatibility, affected queries |
| Supabase migration | clean apply, anon/authenticated allow and deny cases |
| Dependency | audit, lockfile review, lint, build and affected behavior |
| Financial logic | boundary amounts, rounding, reconciliation and immutable state |
| Message send/retry | duplicate/concurrent requests and partial failure recovery |

## Manual browser checks

For UI changes, use representative widths including a small phone and desktop.
Check keyboard operation, visible focus, loading/empty/error/success states and
both themes. Public routes must work on a direct URL load and refresh.

Never use production personal data in screenshots or fixtures.

## API tests to add

Session verification, Turnstile, webhook signatures and media tickets are
covered above. Prioritize isolated tests for:

- future role/organization authorization;
- duplicate and replayed webhook deliveries against the idempotency ledger;
- contact import byte/row/column/decompression limits;
- public GST and WhatsApp daily budgets;
- campaign claims, retries and duplicate requests;
- status reconciliation for out-of-order receipts;
- upload type/size/content validation.

Mock external providers. Tests must not send real WhatsApp messages, consume a
paid API quota or write a shared cloud database.

## Database policy tests to add

For each exposed table/bucket, maintain a matrix covering:

- anonymous select/insert/update/delete;
- authenticated user without required membership/role;
- authenticated user with each allowed role;
- cross-organization access;
- service-role server workflow;
- attempts to change server-controlled fields;
- guessed object paths and another vendor's document.

Run these against an isolated local or disposable project.

## Fixtures

- Use obviously synthetic names, phones, emails, GSTIN-like values and files.
- Keep fixtures small and deterministic.
- Never copy production rows, webhook bodies or documents.
- Store no credentials in snapshots.
- Include malformed/hostile cases separately from normal examples.

## Reporting results

State exactly which commands and scenarios ran. Distinguish:

- **passed**: command/scenario ran and succeeded;
- **failed**: ran and found an issue;
- **not run**: unavailable, unsafe or out of scope;
- **not configured**: no test currently exists.

Do not say “all tests passed” as if it covered behavior the suite does not
test; name the suites that ran.
