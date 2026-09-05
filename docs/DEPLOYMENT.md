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

## Known Limitations

- Docker nginx configuration lacks SPA fallback routing (requires custom `nginx.conf`).
- No automated deployment in CI (`npm run deploy` must be run manually).
- No staging environment is configured.
- No automated database backup strategy is currently documented.
- Edge Function observability relies solely on Supabase dashboard logs.
