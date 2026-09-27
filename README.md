
<p align="center">
  <img src="public/dikho-logo.png" alt="Dikho Logo" width="350">
</p>

<p align="center">
  <strong>Advertising Operations & Sales Management Platform</strong>
</p>

<p align="center">
  A centralized platform for managing clients, vendors, sales orders, purchase orders, and advertising operations.
</p>

---

## Documentation

| Document | Description |
| --- | --- |
| **[Architecture](docs/ARCHITECTURE.md)** | System design, frontend/backend architecture, auth flow, business logic |
| **[Database Schema](docs/DATABASE.md)** | Tables, columns, RLS policies, views, migrations, money invariants |
| **[Contributing](CONTRIBUTING.md)** | Setup, development workflow, coding conventions, security guidelines |
| **[Deployment](docs/DEPLOYMENT.md)** | Cloudflare, Docker, Edge Functions, CI/CD, production checklist |

---

## Overview

**Dikho** is an internal advertising operations platform designed to manage the complete workflow between clients, sales orders, vendors, and purchase orders.

It provides a centralized system for managing advertising campaigns and operational data, replacing fragmented spreadsheets and manual workflows with a structured digital system.

### Core Workflow

```text
Client
  │
  ▼
Sales Order (SO)
  │
  ▼
Vendor Selection
  │
  ▼
Purchase Order (PO)
  │
  ▼
Campaign Execution
  │
  ▼
Revenue & Profit Tracking
```

---

## Features

* **Client Management** — Maintain structured client records.
* **Vendor Management** — Manage advertising vendors and their services.
* **Sales Orders** — Create and track client-facing sales orders.
* **Purchase Orders** — Create and track vendor purchase orders.
* **SO–PO Relationship** — Connect sales orders with their corresponding purchase orders.
* **Revenue & Profit Tracking** — Monitor campaign revenue, costs, and margins.
* **Advertising Categories** — Organize campaigns across ATL, TTL, and BTL media.
* **Centralized Data** — Keep operational information in one system.
* **Authentication** — Secure access for authorized users.
* **Dashboard** — Overview of important operational and financial information.

---

## Advertising Categories

Dikho organizes advertising operations into three primary categories:

### ATL — Above the Line

* Television
* Radio
* Newspaper
* Cinema
* Magazine
* Sports Marketing

### TTL — Through the Line

* Digital Marketing
* Digital PR
* OTT & Apps
* SEO

### BTL — Below the Line

* Airport
* Transit
* Outdoor
* Corporate Giftings
* In-Shop Branding
* Activations
* Stall Branding
* Corporate Events
* Mall Activations
* Interactive Meets
* Dealer Meetings

---

## Example

A typical advertising transaction can be represented as:

```text
Client
└── Sales Order
    ├── Newspaper Advertisement
    ├── Selling Price: ₹1,00,000
    └── Vendor
        └── Purchase Order
            ├── Times of India
            └── Cost: ₹70,000

Revenue: ₹1,00,000
Vendor Cost: ₹70,000
Gross Profit: ₹30,000
```

---

## Architecture

Dikho is built as a modern web application with a modular architecture.

```text
Frontend
   │
   ├── Authentication
   ├── Dashboard
   ├── Clients
   ├── Vendors
   ├── Sales Orders
   └── Purchase Orders
          │
          ▼
      Supabase
          │
          ├── Authentication
          └── Database
```

---

## Technology

| Layer            | Technology              |
| ---------------- | ----------------------- |
| Frontend         | React                   |
| Build Tool       | Vite                    |
| Language         | TypeScript / JavaScript |
| Backend Services | Supabase                |
| Authentication   | Supabase Auth           |
| Database         | PostgreSQL              |
| Deployment       | Cloudflare              |
| Version Control  | Git / GitHub            |

---

## Project Structure

```text
dikho/
├── public/
│   └── dikho-logo.png
│
├── src/
│   ├── components/
│   ├── pages/
│   ├── services/
│   ├── hooks/
│   └── ...
│
├── .env
├── package.json
├── vite.config.*
└── README.md
```

---

## Getting Started

### Requirements

* Node.js
* npm
* Git
* Supabase project

### Installation

Clone the repository:

```bash
git clone https://github.com/Axoineo/dikho/
cd dikho
```

Install dependencies:

```bash
npm install
```

Configure environment variables according to the project's environment configuration.

Start the development server:

```bash
npm run dev
```

The application will then be available through the local Vite development server.

---

## Environment

Dikho uses environment variables for external services and application configuration.

Copy the template and fill in your own values:

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Only `VITE_`-prefixed variables are bundled into the browser. The publishable
("anon") key is designed to be public — table access is enforced by Row Level
Security, not by keeping the key secret.

`.env.local` is gitignored. Do **not** commit production credentials, private
keys, service-role keys, or other secrets to the repository.

### Edge Function secrets

The `device-check` Edge Function runs server-side and is configured separately
from the frontend. These values must never appear in `.env.local` or any
`VITE_`-prefixed variable.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | auto | Injected by Supabase at runtime. |
| `SUPABASE_ANON_KEY` | auto | Injected by Supabase; used to validate the caller's JWT. |
| `SUPABASE_SERVICE_ROLE_KEY` | auto | Injected by Supabase; bypasses RLS for device writes. |
| `ALLOWED_ORIGINS` | **yes** | Comma-separated browser origins allowed to call the function. |
| `BREVO_API_KEY` | no | Enables new-device alert emails. Alerts are skipped if unset. |
| `BREVO_SENDER_EMAIL` | no | Sender address for alert emails. Defaults to `security@dikho.in`. |

Set them with the Supabase CLI:

```bash
supabase secrets set ALLOWED_ORIGINS="https://dikho.in,https://www.dikho.in"
```

If `ALLOWED_ORIGINS` is unset, the function falls back to `http://localhost:5173`
so local development works — which means browser calls from your production
domain will be blocked by CORS until you set it.

Do **not** commit production credentials, private keys, service-role keys, or other secrets to the repository.

---

## Development

Create a feature branch before making changes:

```bash
git checkout -b feature/your-feature
```

Run the application locally:

```bash
npm run dev
```

Before pushing changes, verify that the application builds successfully:

```bash
npm run build
```

Keep the `main` branch stable and avoid unnecessary changes or comments unrelated to the feature being developed.

---

## Deployment

The application is designed for web deployment and can be deployed through the project's configured Cloudflare infrastructure.

Production deployment should use production environment variables and credentials configured outside the repository.

---

## Security

Dikho handles business and operational data. Security should therefore be treated as a core requirement.

* Never commit secrets to Git.
* Use environment variables for credentials.
* Keep the service-role key server-side only — never in a `VITE_` variable.
* Restrict Edge Function access with `ALLOWED_ORIGINS` rather than a wildcard.
* Restrict database access through appropriate Supabase policies.
* Use authentication for protected application areas.
* Follow least-privilege access principles.
* Review database permissions before production deployment.

---

## Status

**Development**

Dikho is actively being developed. Features, database structures, and internal workflows may change as the platform evolves.

---

## License

This repository is private and proprietary to **Dikho**.

Unauthorized copying, redistribution, or commercial use of the source code is not permitted without permission from the project owner.

---

<p align="center">
  <strong>Dikho</strong><br>
  Advertising Operations Platform
</p>
