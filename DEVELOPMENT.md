# Development Guide

This guide describes the current repository. Security-sensitive changes must
also follow [SECURITY.md](SECURITY.md) and the open work in
[the security audit](docs/SECURITY-AUDIT.md).

Coding agents must start with [AGENTS.md](AGENTS.md). More specific instruction
files apply inside the API and migration directories.

## Stack and runtime boundaries

- React 19 and React Router 7 for the browser application.
- Vite 8 for local development and production builds.
- Hono on a standalone Cloudflare API Worker.
- Supabase Auth, PostgreSQL/PostgREST, Storage and one Edge Function.
- Cloudflare D1 for WhatsApp operational data and R2 for WhatsApp media.
- JavaScript/JSX in the app and API; TypeScript in the Supabase Edge Function.

The SPA, API Worker and Supabase components are separate trust boundaries. A
browser-side check is never a substitute for API authorization or RLS.

## Setup

```bash
npm ci
cp .env.example .env.local
cp .dev.vars.example .dev.vars
npm run dev
```

Start the API Worker in another terminal when needed:

```bash
npm run dev:api
```

Use development projects and credentials. Do not put a production secret in a
local example, test fixture, Markdown file or `VITE_` variable.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite frontend |
| `npm run dev:api` | Start the standalone API Worker |
| `npm run build` | Create the production frontend bundle |
| `npm run lint` | Run oxlint |
| `npm run scan:secrets` | Scan source/build output for likely credentials |
| `npm test` | Run the tests in `tests/` with Node's built-in test runner |
| `npm run check` | Run lint, tests, production build and the source/build secret scan |
| `npm run preview` | Build and run the standalone SPA Worker locally |
| `npm run deploy` | Deploy the standalone SPA Worker; this does **not** update production |
| `npm run deploy:api` | Deploy the API Worker |

Production serves the SPA from Cloudflare Pages, which builds and deploys every
push to `main`. A push to `main` is therefore a production release; see
[Deployment](docs/DEPLOYMENT.md).

`npm test` runs isolated tests that need no extra dependencies and never touch
the network: they mock `fetch` and the clock. Add tests there for new security
boundaries instead of relying only on manual checks. See
[Testing](docs/TESTING.md) for what is and is not covered.

### Previewing pages without a session

`scripts/preview/` holds harnesses that render real page components against
stubbed, synthetic data, so a page can be checked without signing in or touching
a real database. With `npm run dev` running, open
`/scripts/preview/<name>.html`, for example `/scripts/preview/vendors.html`.
They load the same stylesheets and fonts as the app and never submit.

## Source organization

```text
src/
├── api/
│   ├── middleware/      # authentication, CORS and error handling
│   ├── routes/          # Hono route modules
│   ├── services/        # Meta, Turnstile, API Setu and Supabase RPC clients
│   └── worker.js        # API entry point and scheduled work
├── app/                 # React root
├── components/          # reusable view components
├── features/            # feature-specific views and logic
├── layouts/             # public/authenticated shells
├── lib/                 # browser client and pure helpers
├── routes.jsx           # lazy route configuration
└── worker.js            # standalone SPA Worker, unused in production
```

Keep business features under `src/features/<domain>`. Keep Worker-only code out
of browser imports. Never import from `scripts/` into application code.

## Frontend conventions

- Use functional components and hooks.
- Keep feature-specific CSS beside the feature when practical.
- Use the existing design tokens and support light/dark/system themes.
- Lazy-load route-level features through `src/routes.jsx`.
- Keep secrets and privileged logic out of the browser bundle.
- Treat all form, route, URL and local-storage values as untrusted.
- Do not render untrusted HTML. Prefer React text interpolation.
- Abort stale network requests when later input supersedes them.

The centralized Supabase client is `src/lib/supabase.js`. The centralized API
client is `src/lib/api.js`.

## API conventions

- Protected routes must use `requireAuth` and any required role check.
- A valid JWT proves identity, not permission. Document the required role for
  destructive, financial, export and message-sending actions.
- Parse untrusted bodies defensively and impose byte/row/field limits.
- Bind SQL values; never concatenate untrusted values into SQL identifiers or
  clauses.
- Return generic external errors and log only a sanitized internal event.
- Set upstream timeouts and fail closed when an authorization dependency is
  unavailable.
- Verify webhook signatures over the exact raw request bytes before parsing.
- Keep retries idempotent and guard operations that spend money or send messages.

The current `requireAuth` middleware validates Supabase sessions but does not
yet implement fine-grained roles. Do not add a new sensitive endpoint assuming
that authentication alone is sufficient.

## File and media handling

For every upload or import:

1. reject oversized requests before reading the entire body;
2. allowlist supported formats;
3. validate magic bytes/content as well as `Content-Type`;
4. cap decompressed size, archive entries, rows, columns and cell lengths;
5. generate storage keys server-side where trust matters;
6. use private storage and short-lived access;
7. avoid logging filenames or document contents unless required.

Contact XLSX parsing and WhatsApp uploads still need some of these limits; see
the security audit before extending them.

## Database and migration conventions

Cloudflare D1 migrations live in `migrations/`. Supabase PostgreSQL migrations
live in `supabase/migrations/`.

- Migrations are append-only once deployed.
- Use explicit grants and revoke the implicit `PUBLIC` function grant where
  appropriate.
- Set a safe `search_path` on `SECURITY DEFINER` functions.
- Enable RLS and add least-privilege policies before granting table access.
- Never use `USING (true)` for a new sensitive table without recording why all
  authenticated users should have full access.
- Test both allowed and denied cases with the real `anon` and `authenticated`
  roles.
- Inspect effective Storage policies separately from table RLS.
- Back up and prepare rollback steps before destructive schema changes.

Historical schema snapshots are reference material, not a safe deployment
shortcut. Apply ordered migrations using the documented deployment procedure.

## Logging and privacy

Use the API logger, but pass only necessary fields. Never log:

- authorization headers, JWTs, API keys or webhook signatures;
- OTP values or signed URLs;
- service-role credentials;
- raw WhatsApp payloads or message bodies;
- full phone numbers, email addresses or uploaded documents.

Prefer event names, status codes and hashed identifiers. Any temporary verbose
logging must be removed before deployment.

## Dependency changes

Prefer platform APIs or existing dependencies when maintainable. For every new
package, review maintenance, license, transitive dependencies and bundle/runtime
impact. Update the lockfile and run:

```bash
npm audit --omit=dev
npm run check
```

## Pre-merge checklist

- [ ] The change has a documented trust boundary and authorization rule.
- [ ] Client and server validation both exist where applicable.
- [ ] RLS/Storage policies were tested for denied access.
- [ ] Uploads have explicit byte/type/decompression limits.
- [ ] Logs and errors contain no secrets or unnecessary personal data.
- [ ] New environment variables are documented by name only with placeholders.
- [ ] Migrations are ordered, reviewed and have rollback notes.
- [ ] `npm run check` passes.
- [ ] `npm audit --omit=dev` has no unaccepted production findings.
- [ ] Relevant public, authenticated, mobile and dark-theme flows were checked.

Last updated: 2026-10-04.
