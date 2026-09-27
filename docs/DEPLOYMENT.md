# Deployment Guide

This document outlines the deployment and operations procedures for the Dikho project.

## Primary Deployment: Cloudflare Workers

Dikho uses Cloudflare Workers for its primary hosting, serving a React Single Page Application (SPA).

### Configuration (`wrangler.jsonc`)

The project is configured to run as an SPA on Cloudflare Pages/Workers:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "dikho-so-po",
  "compatibility_date": "2026-08-20",
  "observability": { "enabled": true },
  "assets": { "not_found_handling": "single-page-application" }
}
```

The `not_found_handling: "single-page-application"` setting routes all unmatched requests to `index.html`, enabling client-side routing.

### Vite Configuration (`vite.config.js`)

The `@cloudflare/vite-plugin` is utilized to integrate Vite builds with Cloudflare.

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
})
```

### Deploying to Cloudflare

Ensure you are authenticated with Wrangler (`wrangler login`) and have a Cloudflare account configured.

```bash
# Preview locally (builds then runs Wrangler dev server)
npm run preview

# Deploy to production
npm run deploy  # runs: npm run build && wrangler deploy
```

## Alternative Deployment: Docker

A multi-stage Dockerfile is provided for self-hosting.

### Dockerfile

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
RUN VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
    VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
    npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Build & Run

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key \
  -t dikho .

docker run -p 80:80 dikho
```

> [!WARNING]
> The default `nginx:alpine` configuration does not handle SPA fallback routing. If you use Docker deployment, you must provide a custom `nginx.conf` that falls back to `index.html` for client-side routes to work correctly.

### `.dockerignore`

```
node_modules
dist
.git
.env
.env.local
npm-debug.log
```

## Supabase Edge Functions

### Device-Check Function

Location: `supabase/functions/device-check/index.ts`

Deploy the function using the Supabase CLI:
```bash
supabase functions deploy device-check
```

### Edge Function Secrets

Secrets must be set via the Supabase CLI. **Never place these in `.env.local` or any `VITE_` variable.**

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | auto-injected | Supabase project URL |
| `SUPABASE_ANON_KEY` | auto-injected | Validates caller JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected | Bypasses RLS for device writes |
| `ALLOWED_ORIGINS` | **yes** | Comma-separated browser origins for CORS |
| `BREVO_API_KEY` | no | Enables new-device alert emails |
| `BREVO_SENDER_EMAIL` | no | Sender address (defaults to security@dikho.in) |

```bash
# Set production origins
supabase secrets set ALLOWED_ORIGINS="https://dikho.in,https://www.dikho.in"

# Set email alerts (optional)
supabase secrets set BREVO_API_KEY="your-brevo-api-key"
```

> [!NOTE]
> If `ALLOWED_ORIGINS` is unset, it defaults to `http://localhost:5173` for local development. Production browser requests will be blocked by CORS unless properly configured.

## Database Migrations

Migration files are located in `supabase/migrations/`. They are designed to be idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`).

Apply migrations:
```bash
# Push migrations to remote Supabase project
supabase db push
```
Alternatively, copy-paste the migration contents into the Supabase Dashboard → SQL Editor.

## Cloudflare Turnstile (public forms)

The two unauthenticated forms — `/vendor/register` and `/corporategifting` — are
protected by Turnstile widget `0x4AAAAAAEnxgBvSPuBu7S85` ("managed" mode).

**The widget alone protects nothing.** The token it produces is only meaningful
because `POST /api/public/vendor` and `POST /api/public/cg-lead` on the
`dikho-api` Worker verify it against Cloudflare's `siteverify` before writing
(`src/api/services/turnstile.js`), and because `anon` no longer has `EXECUTE` on
the underlying RPCs (`20260927000000_turnstile_lockdown.sql`). Removing either
half turns the check back into decoration.

Three things are checked, not just `success`:

| Check | Why |
|-------|-----|
| `success === true` | the challenge was actually solved |
| `action` matches | a token minted on one form can't be replayed against the other |
| `hostname` in allowlist | a token solved on an attacker's page is rejected |

The `action` values are bound in two places and must stay in sync:
`TURNSTILE_ACTION` in each form under `src/features/public/`, and
`ACTION_VENDOR_REGISTER` / `ACTION_CG_LEAD` in `src/api/routes/public/index.js`.
A widget rendered with no `action` gets no `action` back from `siteverify`, so a
mismatch fails *every* submit — it shows up as `turnstile.rejected` in
`wrangler tail`.

### Worker configuration

| Variable | Notes |
|----------|-------|
| `TURNSTILE_SECRET` | Widget secret. `npx wrangler secret put TURNSTILE_SECRET --name dikho-api` |
| `TURNSTILE_HOSTNAMES` | Comma-separated. Committed as a plain var in `wrangler.api.jsonc` (non-sensitive, and vars in the config file survive deploys). **Production must not include `localhost`/`127.0.0.1`** — `.dev.vars` overrides it locally. |
| `SUPABASE_SERVICE_ROLE_KEY` | Lets the Worker call the locked-down RPCs. Never `VITE_`-prefixed. |
| `SUPABASE_URL` | Already required by `requireAuth`. |
| `ALLOWED_ORIGINS` | Must include whatever origin serves the public forms, or their POST is blocked by CORS. |

Read the secret without putting it on a command line or in chat:
```bash
npx wrangler turnstile widget get 0x4AAAAAAEnxgBvSPuBu7S85 --json | jq -er '.secret'
```

Verification fails **closed**: if `TURNSTILE_SECRET` or `TURNSTILE_HOSTNAMES` is
missing, the forms break (HTTP 500) rather than silently accepting writes.

### Rollout order (this ordering matters)

The lockdown migration and the frontend are coupled the same way the Phase 1/2
public-write split was:

1. Set `TURNSTILE_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` on `dikho-api`
   (`TURNSTILE_HOSTNAMES` ships in `wrangler.api.jsonc`, so a deploy sets it).
2. `npm run deploy:api` — publishes `/api/public/*`. Safe on its own: the live
   bundle still calls the RPCs directly, so nothing switches over yet.
3. **Merge/push to `main`** — the SPA is a Cloudflare **Pages** project
   (`dikho`, Git-connected, auto-builds Production from `main`). This is the step
   that points the forms at the Worker. Note `npm run deploy` does *not* do this
   — it deploys the unused `dikho-so-po` Worker, which no domain points at.
4. Verify **both** public forms submit end to end.
5. Apply `supabase/migrations/20260927000000_turnstile_lockdown.sql`.

Two ordering hazards, both of which break the live forms:

- **Step 3 before step 1.** The forms start posting to the Worker, which fails
  closed — missing `TURNSTILE_SECRET` returns 500, and a missing
  `SUPABASE_SERVICE_ROLE_KEY` fails at the RPC call. Because step 3 is a plain
  `git push`, this is easy to trigger by accident: set the secrets first.
- **Step 5 before steps 2-3.** The deployed bundle is still calling the RPC as
  `anon`, so every submit fails with "permission denied for function".

### Testing

Cloudflare's dummy secrets exercise each branch without a real challenge:

```bash
# always passes / always fails / always "already spent"
for s in 1x0000000000000000000000000000000AA          2x0000000000000000000000000000000AA          3x0000000000000000000000000000000AA; do
  curl -sS https://challenges.cloudflare.com/turnstile/v0/siteverify     -H 'Content-Type: application/x-www-form-urlencoded'     -d "secret=$s&response=dummy"; echo
done
```

Tokens are **single-use** — a second `siteverify` call with the same token
returns `timeout-or-duplicate`. Both forms therefore reset their widget after a
failed submit, so a retry gets a fresh challenge instead of failing as a
duplicate.

## CI/CD: GitHub Actions

Workflow: `.github/workflows/node.js.yml`

- **Triggers**: Push to `main`, PRs targeting `main`
- **Matrix**: Node.js 20.x and 22.x
- **Steps**: `npm ci` → `npm run build` → `npm test`
- **Note**: Automated deployment is *not* configured. Deployment is manual via `npm run deploy`.

## Environment Variables Summary

### Frontend (`.env.local`, gitignored)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon (publishable) key |

Only `VITE_`-prefixed variables are bundled into the browser. The anon key is public by design; data access control is handled by Row Level Security (RLS).

### Docker Build Args
Same as frontend variables, passed as `--build-arg` during `docker build`.

## Production Checklist

Before launching to production, complete the following checks:

1. [ ] Set `ALLOWED_ORIGINS` on Edge Function to production domains
2. [ ] Verify RLS policies are enabled on all tables
3. [ ] Ensure service-role key is not exposed in any client-side code
4. [ ] Review Supabase Auth settings (email templates, rate limits)
5. [ ] Configure Cloudflare custom domain and SSL
6. [ ] Set up Brevo API key for security alert emails (optional)
7. [ ] Verify `.env.local` is NOT committed to Git
8. [ ] Run `npm run build` successfully before deploying
9. [ ] Test the public vendor registration form at `/vendor/register` works
10. [ ] Verify device-check function is deployed: `supabase functions list`
11. [ ] Set `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES` and `SUPABASE_SERVICE_ROLE_KEY` on `dikho-api`
12. [ ] Confirm `TURNSTILE_HOSTNAMES` in production excludes `localhost` and `127.0.0.1`
13. [ ] Apply `20260927000000_turnstile_lockdown.sql` **only after** the Worker and SPA are live (see Rollout order)
14. [ ] Confirm both public forms still submit after the lockdown migration

## Known Limitations

- Docker nginx configuration lacks SPA fallback routing (requires custom `nginx.conf`).
- No automated deployment in CI (`npm run deploy` must be run manually).
- No staging environment is configured.
- No automated database backup strategy is currently documented.
- Edge Function observability relies solely on Supabase dashboard logs.
- The vendor form's document upload still goes straight from the browser to
  Supabase storage under an anon INSERT policy, so it is **not** behind
  Turnstile — a bot can push objects into `vendors_documents/` without touching
  the verified RPC path. Closing this means proxying the upload through the
  Worker (or moving it to R2).
