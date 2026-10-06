# API Worker Instructions

These instructions extend the repository root `AGENTS.md` for `src/api/`.

## Route classification

- Explicitly classify every endpoint as public, authenticated or provider-hook.
- `requireAuth` admits staff only (a role in `app_metadata.dikho_roles`);
  apply it to protected routes and add a separate permission check
  whenever not every authenticated operator should perform the action.
- Public endpoints need documented abuse, rate, cost and failure controls.
- CORS is browser policy, not authentication.

## Input and output

- Parse request bodies defensively and return the standard response envelope.
- Enforce byte and field limits before buffering or expensive parsing: read
  bodies with `utils/body.js`, never `c.req.json()`, `formData()`,
  `arrayBuffer()` or `text()` directly.
- Decide stored or served file types with `utils/fileType.js` (the bytes), not
  the caller's filename or `Content-Type`.
- Bind every untrusted SQL value.
- Use fixed allowlists for dynamic SQL identifiers, sort keys and statuses.
- Return generic external failures; log only sanitized event metadata.
- Apply timeouts to required upstream requests and fail closed for verification
  dependencies.

## Webhooks and messaging

- Verify signatures against the untouched raw body before JSON parsing.
- Preserve timestamp/replay checks where the provider supports them.
- Enter retryable events into the idempotency ledger before side effects.
- Message sends must remain idempotent, concurrency-bounded and budget-aware.
- Never log OTPs, authorization/signature headers, message bodies or raw
  provider payloads containing personal data.

## Media

- Validate size and content, not just filename or caller-provided MIME type.
- Generate trusted object keys server-side.
- Keep WhatsApp objects behind short-lived tickets or authenticated fetching.
- Reject invalid range requests and avoid exposing arbitrary R2 prefixes.

## Verification

Exercise success plus unauthorized, forbidden, malformed, oversized, expired,
replayed, duplicate and upstream-timeout behavior relevant to the change.
