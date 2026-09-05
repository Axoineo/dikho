# Contributing to Dikho

Welcome to the Dikho project! This guide outlines the setup process, coding conventions, and workflow for contributing to the repository.

## About Dikho

Dikho is an internal advertising operations platform (CRM) designed for Indian advertising agencies to manage clients, vendors, sales orders, and purchase orders.

## Tech Stack

- **Frontend**: React 19 + Vite 8 (JavaScript/JSX, no TypeScript on frontend)
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Deployment**: Cloudflare Workers (primary), Docker (alternative)
- **Linter**: oxlint with React plugin
- **Styling**: Vanilla CSS with CSS custom properties (no Tailwind, no CSS-in-JS)
- **Font**: Google Sans (loaded via Google Fonts)
- **Runtime**: Node.js 20.x or 22.x

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (≥ 20)
- npm
- Git
- A Supabase project (for database and authentication)
- Wrangler CLI (installed via devDependency for Cloudflare deployment)
- Supabase CLI (for deploying Edge Functions and migrations)

## Setup Instructions

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Axoineo/dikho/
   cd dikho
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure environment variables**:
   ```bash
   cp .env.example .env.local
   ```
   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.

4. **Start the development server**:
   ```bash
   npm run dev
   ```
   The Vite dev server will start at [http://localhost:5173](http://localhost:5173).

## Environment Variables

### Frontend (`.env.local`)
| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key (safe for browser) |

### Edge Function Secrets (via `supabase secrets set`)
| Variable | Description |
|---|---|
| `ALLOWED_ORIGINS` | Comma-separated origins for CORS |
| `BREVO_API_KEY` | Optional, for new-device email alerts |
| `BREVO_SENDER_EMAIL` | Optional, defaults to security@dikho.in |

> [!NOTE]
> The Supabase runtime automatically injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into Edge Functions.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run lint` | Run oxlint |
| `npm run preview` | Build + run locally via Wrangler |
| `npm run deploy` | Build + deploy to Cloudflare Workers |

## Code Organization

```
src/
├── App.jsx              # Core monolith: auth, shell, clients, vendors, SOs, settings, utilities
├── index.css            # Complete design system (CSS variables, themes, layouts)
├── main.jsx             # React entry point
├── supabase.js          # Supabase client initialization
├── xlsx.js              # Zero-dep Excel export utility
├── ContactDetails.jsx   # Contact card component
├── ContactDetails.css   # Contact card styles
├── ContactHoverAction.jsx # Table cell action buttons
├── pages/
│   ├── PurchaseOrders.jsx  # Purchase order module
│   └── PublicVendorForm.jsx # Public vendor registration
supabase/
├── functions/device-check/ # Device tracking Edge Function (Deno/TypeScript)
├── migrations/             # SQL migration files
```

> [!WARNING]
> `src/App.jsx` is currently a 4,900-line monolith encompassing the Login, Sidebar, Clients, Vendors, Sales Orders, Settings, and 30+ shared utility functions. **New modules should be added as separate files in `src/pages/` when possible.**

## Development Workflow

1. Create a feature branch from `main`: `git checkout -b feature/your-feature`
2. Run the dev server: `npm run dev`
3. Make your code changes.
4. Run the linter: `npm run lint`
5. Verify the build: `npm run build`
6. Push your branch and open a Pull Request against `main`.

## Coding Conventions

- **Branching**: Feature branches should always be created off `main`.
- **Styling**: Strictly use CSS custom properties from `index.css`. Never use inline styles for theming. Ensure dark mode support by using `var(--token)` variables.
- **Components**: Write functional components using React hooks. Do not use class components.
- **State Management**: Rely exclusively on React hooks (`useState`, `useRef`, `useMemo`). No external state libraries (e.g., Redux, Zustand) are used.
- **Imports from App.jsx**: Shared utilities (e.g., `formatMoney`, `splitGst`, `Icon`, `SearchableSelect`) are exported from `App.jsx`. Import them like `import { formatMoney } from '../App'`.
- **Database Access**: Always use the shared Supabase client exported from `src/supabase.js`.
- **Money Handling**: All money columns in the database are `numeric(14,2)`. Use `round2()` for all calculations. The UI must explicitly reconcile totals prior to every database write.
- **Testing**: There is no formal test suite yet. Use the preview harnesses in `/preview/` for offline component testing.

## Database Migrations

Migration files are stored in `supabase/migrations/` and use the naming format `YYYYMMDD_description.sql`.

> [!TIP]
> - Ensure migrations are idempotent. Use `IF NOT EXISTS` and `DROP POLICY IF EXISTS` followed by `CREATE POLICY`.
> - Always end your migrations with `NOTIFY pgrst, 'reload schema';` to refresh the PostgREST schema cache.

## Security Guidelines

> [!CAUTION]
> - **Never** commit `.env.local` or any secrets to Git.
> - The `VITE_SUPABASE_PUBLISHABLE_KEY` is public by design; Row Level Security (RLS) acts as the access control layer.
> - **Service-role keys must only be used server-side** (e.g., Edge Functions) and should never be exposed in `VITE_` variables.
> - Always set `ALLOWED_ORIGINS` for Edge Function CORS in production.
> - Thoroughly review RLS policies before deploying any schema changes.

## Useful Links

- [Architecture Guide](docs/ARCHITECTURE.md)
- [Database Schema](docs/DATABASE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
