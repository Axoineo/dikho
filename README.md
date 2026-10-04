<p align="center">
  <img src="public/dikho-logo.svg" alt="Dikho" width="350">
</p>

<p align="center">
  <strong>Advertising operations, CRM and WhatsApp workspace</strong>
</p>

Dikho is currently the internal operations platform for Dikho Global Media LLP,
covering clients, vendors, sales and purchase orders, invoicing, public lead
capture, WhatsApp campaigns and a two-way WhatsApp inbox.

The longer-term goal is a configurable public release for small businesses:
each organization can apply its identity, provision its own infrastructure,
connect its own database and provider accounts, and operate an isolated
self-hosted instance. It is not yet ready for that distribution model.

## Documentation

| Document | Purpose |
| --- | --- |
| [Visual system handbook](VISUALIZE.md) | Diagrams, flows, trust boundaries and privacy-safe screenshots |
| [Agent instructions](AGENTS.md) | Shared Codex and Claude Code working rules |
| [Product direction](docs/PRODUCT.md) | Users, outcomes, principles and open decisions |
| [System invariants](docs/INVARIANTS.md) | Rules that changes must preserve |
| [Architecture](docs/ARCHITECTURE.md) | Runtime boundaries, request flows and trust boundaries |
| [Database](docs/DATABASE.md) | Supabase/Postgres, D1, RLS, Storage and migrations |
| [Testing](docs/TESTING.md) | Current checks, gaps and required behavioral coverage |
| [Roadmap](docs/ROADMAP.md) | Ordered engineering priorities |
| [Decisions](docs/decisions/README.md) | Accepted architecture decision records |
| [Task briefs](docs/tasks/README.md) | Durable handoff format for work spanning sessions |
| [Runbooks](docs/runbooks/README.md) | Incident, credential-rotation and rollback procedures |
| [Deployment](docs/DEPLOYMENT.md) | Safe configuration, rollout and production checks |
| [Security](SECURITY.md) | Reporting policy and secure engineering rules |
| [Security audit](docs/SECURITY-AUDIT.md) | Current findings and remediation priorities |
| [Development](DEVELOPMENT.md) | Local setup and implementation conventions |
| [Contributing](CONTRIBUTING.md) | Review workflow and merge checklist |
| [WhatsApp login](docs/whatsapp-auth.md) | Passwordless WhatsApp OTP setup and operation |

## Current architecture

```text
Browser
├── Supabase Auth (email or WhatsApp-delivered OTP)
├── Supabase PostgREST and private Storage (business records)
├── Supabase Edge Function (device audit and optional alert)
└── Cloudflare API Worker
    ├── authenticated dashboard APIs
    ├── Turnstile-protected public form writes
    ├── signed Meta/Supabase webhook receivers
    ├── D1 (WhatsApp contacts, conversations, campaigns and budgets)
    └── R2 (re-hosted WhatsApp media and avatars)
```

The SPA is served by Cloudflare Pages, which builds and deploys every push to
`main`; the API is a separate Cloudflare Worker. The frontend never receives a
service-role key, Meta token, webhook secret, Turnstile secret or API provider
key. See [Architecture](docs/ARCHITECTURE.md) for complete trust boundaries.

## Features

- client and vendor management;
- sales orders, purchase orders and GST calculations;
- invoice generation and finance records;
- invite-only email and WhatsApp OTP sign-in;
- public vendor registration and corporate-gifting lead capture;
- GSTIN lookup with rate and global-budget controls;
- WhatsApp contact import, approved-template campaigns and retry tracking;
- two-way WhatsApp inbox with protected media;
- new-device login records and optional email alerts.

## Technology

| Layer | Technology |
| --- | --- |
| UI | React 19, React Router 7, Vite 8, JavaScript/JSX |
| Application API | Hono on Cloudflare Workers |
| Business database | Supabase PostgreSQL/PostgREST |
| Messaging database | Cloudflare D1 |
| Files/media | Supabase Storage and Cloudflare R2 |
| Authentication | Supabase Auth passwordless OTP |
| Bot protection | Cloudflare Turnstile |
| Quality | oxlint, Node test runner, build validation, secret scan |

## Repository map

```text
src/
├── api/                  # standalone API Worker, middleware and integrations
├── app/                  # React application root
├── components/           # shared UI components
├── features/             # domain-focused screens and business logic
├── layouts/              # authenticated and public shells
├── lib/                  # browser-side clients and pure utilities
├── routes.jsx            # route definitions and lazy loading
└── worker.js             # standalone SPA Worker, unused in production
migrations/               # Cloudflare D1 migrations
supabase/
├── functions/            # Supabase Edge Functions
└── migrations/           # PostgreSQL/RLS/Storage migrations
scripts/                  # developer and operational utilities
docs/                     # architecture, operations and security documentation
```

## Local setup

Requirements: supported Node.js/npm versions, Git and access to development
instances of the configured cloud services.

```bash
git clone <repository-url>
cd dikho
npm ci
cp .env.example .env.local
cp .dev.vars.example .dev.vars
npm run dev
```

Use development-only values. Do not copy production credentials to a local
machine unless an approved operational procedure explicitly requires it.

The browser environment contains only public configuration:

```env
VITE_SUPABASE_URL=<development-project-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<development-publishable-key>
VITE_API_BASE=<development-api-origin>
```

`VITE_` values are visible to every browser user. A publishable Supabase key is
not a secret, but it must be paired with correct RLS. No privileged value may
ever use a `VITE_` prefix.

Start the API Worker separately when working on API features:

```bash
npm run dev:api
```

## Validation

Run these before review:

```bash
npm run check
npm audit --omit=dev
```

`npm run check` runs lint, the tests in `tests/`, the production build and the
secret scan. The tests cover session verification, Turnstile verification,
webhook signatures and media tickets. Routes, RLS, Storage policies and UI flows
have no automated coverage yet; this is a known security and reliability gap.
Do not treat a passing check as proof that authorization or RLS is correct.

## Security baseline

- Keep secrets in the provider secret store, never source, Markdown, shell
  history, screenshots, issues or chat.
- Treat the service-role key, Meta credentials, webhook keys, Turnstile secret,
  provider API keys and mail credentials as production secrets.
- Require server-side authorization for sensitive actions; CORS and hidden UI
  controls are not authorization.
- Verify the effective production RLS and Storage policies after migrations.
- Verify webhook signatures against the exact raw request body.
- Apply strict byte/type limits before parsing or buffering uploaded files.
- Redact credentials, OTPs, message bodies and unnecessary personal data from
  logs.
- Follow the remediation plan in [Security audit](docs/SECURITY-AUDIT.md).

Known high-priority work remains: anonymous vendor-document uploads must move
behind server-side verification, vendor-document policies must be narrowed,
and API/database authorization must grow beyond a valid-session check before
accounts with different trust levels are introduced.

## Deployment

The SPA, API Worker, Supabase functions and database migrations have separate
deployment steps. Every push to `main` deploys the SPA to production, so verify
changes locally before pushing. Rollout order matters for public-form lockdown
changes. Use
the [Deployment guide](docs/DEPLOYMENT.md), keep secrets outside command output,
and verify both public and authenticated flows after deployment.

## Status and license

The project is under active development. Database structures and operational
flows may change. A future public distribution is intended, but no public
license or support policy has been selected yet. Until one is published, the
code is proprietary and no license is granted: redistribution or commercial use
requires authorization from the owner.
