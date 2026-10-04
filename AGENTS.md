# Repository Instructions

These instructions apply to every coding agent working in this repository.
Keep this file concise; detailed knowledge belongs in the linked documents.

## Mission

Dikho is currently the internal advertising operations, CRM, finance and
WhatsApp workspace for Dikho Global Media LLP. The longer-term target is a
configurable self-hosted release for one organization per instance. Optimize
for trustworthy business records, controlled message sending, safe public
intake and operator clarity. Prefer simple, auditable solutions over clever
abstractions.

## Sources of truth

- Product intent and non-goals: `docs/PRODUCT.md`
- Visual system and workflow map: `VISUALIZE.md`
- Cross-cutting invariants: `docs/INVARIANTS.md`
- Technical boundaries: `docs/ARCHITECTURE.md`
- Databases, RLS and Storage: `docs/DATABASE.md`
- Verification expectations: `docs/TESTING.md`
- Deployment and rollback: `docs/DEPLOYMENT.md`
- Security policy and open findings: `SECURITY.md` and
  `docs/SECURITY-AUDIT.md`
- Current priorities: `docs/ROADMAP.md`
- Accepted architectural decisions: `docs/decisions/`

Read only the sources relevant to the task. Verify documentation against code
before relying on details that may have changed.

## Repository boundaries

- `src/` is the React browser application.
- `src/api/` is the standalone Hono API Worker.
- Production serves the SPA from Cloudflare Pages, built from `main` on every
  push. `src/worker.js` and `wrangler.jsonc` define a standalone SPA Worker
  that production does not use; `npm run deploy` publishes that Worker, not
  the live site.
- `supabase/migrations/` contains PostgreSQL, RLS and Storage migrations.
- `migrations/` contains Cloudflare D1 migrations.
- `supabase/functions/` contains Supabase Edge Functions.
- `scripts/` contains operational/developer utilities and is not application
  code.

Never import server-only code, credentials or privileged logic into the browser
bundle.

## Working method

1. Inspect the relevant code, instructions and dirty-worktree state first.
2. Preserve unrelated user changes.
3. State assumptions when they affect behavior or architecture.
4. Make the smallest complete change that satisfies the request.
5. Update durable documentation when behavior or an invariant changes.
6. Verify in proportion to risk and report exactly what was and was not run.

For work spanning sessions, create a brief from `docs/tasks/_template.md`.
Keep it factual and current. At completion, move durable decisions into an ADR
and remove or archive temporary task state.

## Non-negotiable security rules

- Never commit or print secrets, OTPs, session tokens, signed URLs, production
  personal data or private resource identifiers.
- Every `VITE_` value is public. Privileged values must stay server-side.
- Authentication proves identity, not authorization.
- CORS and hidden UI controls are not authorization.
- Verify webhook signatures over the exact raw request body before parsing.
- Treat all request fields, filenames, MIME types, spreadsheet cells and
  provider responses as untrusted.
- Bound request bytes, decompression, row counts, field lengths, concurrency and
  operations that spend money or send messages.
- Keep logs free of credentials, OTPs, message bodies and unnecessary personal
  data.
- Do not weaken Turnstile verification, RLS, Storage policies, media tickets,
  idempotency or global spend controls to make a failing flow pass.
- The anonymous vendor-document upload and broad historical Storage policies
  are known findings. Do not copy those patterns.

## Data and migration rules

- Never edit a migration already applied to a shared environment. Add a forward
  migration.
- Historical schema snapshots are reference material, not deployment shortcuts.
- `SECURITY DEFINER` functions require a safe `search_path`, qualified
  object names, narrow inputs and explicit execution grants.
- RLS and Storage changes require both allow and deny verification.
- Preserve financial reconciliation, message idempotency and campaign audience
  tracking.
- Database migrations, production writes and credential changes require
  explicit user authorization.

More specific instructions live in `src/api/AGENTS.md`,
`supabase/AGENTS.md` and `migrations/AGENTS.md`.

## Commands and validation

Use `npm ci` for a clean dependency install. Do not add or upgrade production
dependencies without explaining the need and reviewing the lockfile.

Safe repository check:

```bash
npm run check
```

This runs lint, the tests in `tests/`, a production build and the high-signal
secret scan. The tests cover session verification, Turnstile verification,
webhook signatures and media tickets only; routes, RLS, Storage and UI have no
automated coverage. Report which checks ran and what they cover, not just that
“tests passed”.

Additional checks:

- Documentation-only changes: resolve local links, run the documentation secret
  scan and `git diff --check`.
- Dependency changes: run `npm audit --omit=dev`.
- Security-sensitive changes: exercise allowed, denied, malformed, expired,
  replayed and duplicate cases as applicable.
- UI changes: verify relevant routes at desktop/mobile sizes and in light/dark
  themes.
- Migration changes: test locally/staging with the real database role model.

The files under `scripts/test/` are legacy manual probes. Do not run them as a
test suite; one expects a local server and another reads local Supabase
configuration.

## Definition of done

- The requested outcome is implemented, not only described.
- Permission-denied and failure behavior are safe and understandable.
- No unrelated files or user changes were overwritten.
- Relevant documentation and task status are current.
- No secret or real production data was introduced.
- Verification results and remaining limitations are reported accurately.

## Actions requiring explicit approval

Do not deploy, push, merge, apply remote migrations, alter cloud configuration,
rotate/reveal credentials, send real messages, upload production files or
delete data unless the user explicitly requests that action.

A push or merge to `main` is itself a production deployment of the SPA. Never
push to find out whether a change works; verify it locally first.

## Code review rules

Flag changes that:

- expose a privileged value to the client;
- add a public or authenticated route without an explicit authorization model;
- accept an upload without byte/type/decompression limits;
- broaden RLS or Storage access;
- make a paid/send operation non-idempotent or unbudgeted;
- log tokens, OTPs, message bodies or personal records;
- mutate issued financial documents without an explicit correction workflow;
- claim verification that was not actually run.
