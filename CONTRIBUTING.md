# Contributing to Dikho

Dikho handles customer, vendor, financial and messaging data. Changes must be
reviewable, least-privileged and safe to deploy independently across the SPA,
API Worker and Supabase.

## Before starting

Read:

- [Shared agent instructions](AGENTS.md), when using Codex or Claude Code
- [Development guide](DEVELOPMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Permissions](docs/PERMISSIONS.md)
- [Configuration](docs/CONFIGURATION.md)
- [Security policy](SECURITY.md)
- [Current security findings](docs/SECURITY-AUDIT.md)

Requirements are Node.js 20 or 22, npm, Git, and development-only Cloudflare
and Supabase access appropriate to the task.

## Setup

```bash
git clone <repository-url>
cd dikho
npm ci
cp .env.example .env.local
cp .dev.vars.example .dev.vars
npm run dev
```

Do not ask another contributor to send secrets through chat or a pull request.
Use the approved provider secret store and access process.

## Workflow

1. Branch from the reviewed main branch.
2. Keep the change focused; avoid unrelated formatting or generated files.
3. Add or update tests for behavioral and security boundaries.
4. Update the relevant documentation and migration/rollout instructions.
5. Run the validation commands below.
6. Explain risk, rollback and any remaining limitations in the pull request.

Use the repository pull-request template. Record notable behavior,
configuration, schema, security and operational changes under `Unreleased` in
[CHANGELOG.md](CHANGELOG.md).

Merging or pushing to `main` deploys the SPA to production through Cloudflare
Pages within about a minute. Verify changes locally before they reach `main`.

```bash
npm run check
npm audit --omit=dev
```

## Code conventions

- Use functional React components and hooks.
- Use default exports for route-level page components and named exports for
  reusable utilities.
- Import shared browser clients from `src/lib/`.
- Keep API routes in `src/api/routes/` and external integrations in
  `src/api/services/`.
- Use CSS custom properties and verify light, dark and small-screen layouts.
- Do not introduce `dangerouslySetInnerHTML`, `eval`, or dynamic code execution
  without a documented security review.
- Bind database parameters and constrain any dynamic identifier to a fixed
  allowlist.
- Keep source files focused; split files when it clarifies ownership or testing.

## Security requirements

- Never commit credentials, OTPs, signed URLs, production personal data or
  private keys, even temporarily.
- Never expose a service-role key, provider token or secret through `VITE_`.
- CORS limits browser access but is not authorization.
- Require a server-side permission check for destructive, financial, export,
  campaign and messaging operations.
- Verify webhook signatures before parsing payloads.
- Put strict byte and type limits on uploads and archive parsing.
- Keep storage private and scope object policies by organization, record and
  role; a bucket-wide authenticated policy needs explicit security approval.
- Log event metadata rather than raw requests or personal content.
- For public endpoints, document bot protection, rate limiting, global spend
  limits and failure behavior.

The anonymous vendor-document upload and broad historical document policies are
known findings. Do not copy those patterns into another feature.

## Database migrations

- D1 migrations belong in `migrations/`.
- PostgreSQL/RLS/Storage migrations belong in `supabase/migrations/`.
- Never edit a migration already applied to a shared environment; add a new one.
- Use a safe `search_path` for `SECURITY DEFINER` functions.
- Revoke implicit function execution grants before granting named roles.
- Test both successful and forbidden operations.
- Include rollout ordering when code and policy changes are coupled.
- Include backup and rollback instructions for destructive changes.

Do not deploy historical schema snapshots as though they were current ordered
migrations.

## Pull-request checklist

- [ ] Scope and user-visible behavior are explained.
- [ ] Trust boundaries and required roles are stated.
- [ ] No secret or real production data appears in code, fixtures, screenshots
      or documentation.
- [ ] Error paths fail safely and do not leak internal details.
- [ ] File processing has explicit resource limits.
- [ ] RLS and Storage allow/deny cases were tested if affected.
- [ ] Public abuse/spend controls were reviewed if affected.
- [ ] Rollout and rollback steps are included if configuration changes.
- [ ] `npm run check` (lint, tests, build, secret scan) and the dependency
      audit were run.
- [ ] Documentation reflects the final behavior.

## Reporting a vulnerability

Do not open a public issue or pull request containing vulnerability details.
Follow the private reporting process in [SECURITY.md](SECURITY.md).

Last updated: 2026-10-05.
