# Dikho CRM Development Guide

Welcome to the development guide for the Dikho CRM project. This document serves as the single source of truth for our architecture, setup procedures, coding conventions, and contribution workflows. 

## 1. Project Overview

Dikho CRM is an internal advertising operations dashboard tailored for the Dikho organization. It is designed to handle clients, vendors, sales orders, purchase orders, and invoicing efficiently.

**Tech Stack:**
* **Frontend:** React 19 + Vite 8 (Vanilla JavaScript + JSX, no TypeScript).
* **Backend:** Supabase (PostgreSQL, PostgREST API, Auth via email OTP, Storage, and Edge Functions).
* **Routing:** React Router v7.
* **Styling:** Vanilla CSS with custom properties, design tokens, and built-in dark theme support.
* **Linter:** oxlint with the React plugin.
* **Deployment:** Cloudflare Workers (Primary) with an alternative Docker/Nginx fallback.
* **Testing:** No test framework configured yet.

The project utilizes a feature-based architecture. Instead of organizing code strictly by file type (e.g., all components in one folder, all styles in another), we group code by business domain (e.g., `auth`, `clients`, `vendors`) to improve maintainability and scalability.

---

## 2. Getting Started

Follow these steps to set up your local development environment.

### Prerequisites
* Node.js (v18 or higher recommended)
* npm (v9 or higher)

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd dikho
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Copy the example environment file to create your local environment setup.
   ```bash
   cp .env.example .env.local
   ```
   Open `.env.local` and configure your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
   ```

4. **Start the Development Server**
   ```bash
   npm run dev
   ```
   The app will typically be available at `http://localhost:5173`.

5. **Deployment**
   To build and deploy to the Cloudflare Worker:
   ```bash
   npm run deploy
   ```

---

## 3. Directory Structure

The project follows a feature-based architecture to isolate business domains.

```
dikho/
├── src/
│   ├── main.jsx                    # React entry point, attaches app to DOM
│   ├── routes.jsx                  # Route definitions and lazy imports
│   ├── app/                        
│   │   ├── App.jsx                 # Root component (router setup, providers)
│   │   └── constants.js            # App-wide constants (e.g., session timeouts)
│   ├── layouts/
│   │   ├── AuthenticatedLayout.jsx # App wrapper (Sidebar + Header + session guard)
│   │   └── PublicLayout.jsx        # Minimal wrapper for public-facing routes
│   ├── features/                   # Feature modules organized by business domain
│   │   ├── auth/                   # Authentication components (Login.jsx)
│   │   ├── clients/                # Client management (ClientsPage, ClientDetails, AddClientModal)
│   │   ├── vendors/                # Vendor management (VendorsPage, VendorDetails, AddVendorModal, helpers)
│   │   ├── sales-orders/           # Sales operations (SalesOrdersPage, SalesOrderEditor, helpers)
│   │   ├── purchase-orders/        # Purchase operations (PurchaseOrdersPage)
│   │   ├── invoices/               # Invoicing logic (generateTaxInvoice.js)
│   │   ├── settings/               # App configuration (SettingsPage)
│   │   └── public/                 # Publicly accessible views (PublicVendorForm, CorporateGiftingCatalogue)
│   ├── components/                 # Shared UI primitives (Icon.jsx, Sidebar.jsx, SearchableSelect.jsx)
│   ├── lib/                        # Pure logic & utilities (no React, no side effects)
│   │   ├── supabase.js             # Singleton Supabase client
│   │   ├── gst.js                  # Indian GST calculation engine
│   │   ├── format.js               # Formatting helpers (strings, numbers)
│   │   ├── money.js                # Currency handling utilities
│   │   ├── dates.js                # Date manipulation helpers
│   │   ├── writeRows.js            # Schema-tolerant database write engine
│   │   ├── xlsx.js                 # Custom, zero-dependency Excel parser/generator
│   │   └── status.js               # Status definitions and mappers
│   ├── styles/                     # Global design system & token definitions
│   │   ├── reset.css               # CSS reset
│   │   ├── tokens.css              # CSS variables/design tokens
│   │   ├── components.css          # Global component styles
│   │   ├── layout.css              # Structural styles
│   │   ├── pages.css               # Page-level specific styles
│   │   └── themes.css              # Light/Dark theme overrides
│   └── worker.js                   # Cloudflare Worker entry point
├── scripts/                        # Node.js CLI tools for developers (PDF generation, DB checks)
├── supabase/                       # Supabase Edge Functions, SQL migrations, seed data
├── docs/                           # Architecture and deployment documentation
└── public/                         # Static assets (logos, fonts, favicons)
```

---

## 4. Scaffolding a New Feature

When building a new feature (e.g., `expenses`), adhere to the feature-based structure. Here is the standard operating procedure (SOP).

### Step 1: Create the Feature Directory
Create a new directory under `src/features/`.
```bash
mkdir src/features/expenses
```

### Step 2: Create the Page Component
Create a page component as the entry point for the feature. It **must** use a default export so it can be easily lazy-loaded.

**`src/features/expenses/ExpensesPage.jsx`**
```jsx
import React, { useState, useEffect } from 'react';
import './expenses.css'; // Feature-scoped CSS

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);

  return (
    <div className="expenses-page">
      <header className="expenses-header">
        <h1>Expenses</h1>
      </header>
      <main className="expenses-content">
        <p>Expense list will appear here.</p>
      </main>
    </div>
  );
}
```

### Step 3: Create Feature-Scoped CSS
Create a CSS file specifically for this feature.
**`src/features/expenses/expenses.css`**
```css
.expenses-page {
  padding: var(--spacing-lg);
  background-color: var(--surface-primary);
}

.expenses-header {
  margin-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--border-color);
}
```

### Step 4: Add Lazy Import to Routes
Update `src/routes.jsx` to include your new feature using `React.lazy()`.

**`src/routes.jsx`**
```jsx
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router';
import AuthenticatedLayout from './layouts/AuthenticatedLayout';
import PlaceholderPage from './components/PlaceholderPage';

// Lazy load features
const ExpensesPage = React.lazy(() => import('./features/expenses/ExpensesPage'));

export function AppRoutes() {
  return (
    <Suspense fallback={<PlaceholderPage title="Loading..." />}>
      <Routes>
        <Route element={<AuthenticatedLayout />}>
          {/* Add your new route here */}
          <Route path="/expenses" element={<ExpensesPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
```

### Step 5: Add Sidebar Entry
Expose the feature to users by adding a link to the navigation sidebar.

**`src/components/Sidebar.jsx`**
```jsx
import { NavLink } from 'react-router';
import Icon from './Icon';

export default function Sidebar() {
  return (
    <nav className="sidebar">
      {/* existing links */}
      <NavLink to="/expenses" className="sidebar-link">
        <Icon name="receipt" />
        <span>Expenses</span>
      </NavLink>
    </nav>
  );
}
```

---

## 5. Routing

We use **React Router v7** using the `<BrowserRouter>` setup. 

* **Lazy Loading:** All feature entry points are loaded dynamically using `React.lazy()` and wrapped in a `<Suspense>` boundary in `routes.jsx`. This ensures minimal bundle sizes by chunking code.
* **AuthenticatedLayout:** Routes that require the user to be logged in are nested under the `<AuthenticatedLayout>`. This layout includes the navigation sidebar, header, and the session guard (which redirects to `/login` if no user session exists).
* **PublicLayout:** Routes that are accessible to external users (e.g., `PublicVendorForm`, `CorporateGiftingCatalogue`) are nested under the `<PublicLayout>`, which provides a minimal UI shell without internal navigation.

---

## 6. State Management

Dikho CRM operates **without external state management libraries** (no Redux, Zustand, etc.).
We rely strictly on React's built-in hooks and proper component composition.

* **Local State:** Use `useState` and `useReducer` for component-level state (e.g., form inputs, toggle switches, local pagination).
* **Derived State:** Compute values on the fly. Use `useMemo` for expensive calculations (e.g., complex filtering over large lists).
* **Lifting State Up:** If multiple sibling components need access to the same state, move the state to their closest common parent and pass it down via props.
* **Context API:** Only use `React.createContext` for truly global, slowly changing data (e.g., current user session, theme preference). Do not use Context for frequently updating data to avoid unnecessary re-renders.

---

## 7. Styling

The project uses Vanilla CSS with a strong emphasis on CSS custom properties (variables) defined in `styles/tokens.css`. 

* **Design Tokens:** Always use CSS variables for colors, spacing, typography, and borders to ensure consistency.
  * Brand Blue: `var(--brand-blue)` (evaluates to `#185494`)
  * Accent: `var(--accent)` (evaluates to `#f9af1b`)
* **Naming Convention:** Use a BEM-lite approach for class names (e.g., `.vendor-card`, `.vendor-card__title`, `.vendor-card--active`).
* **Component Co-location:** Feature-specific CSS should live next to the JSX file (e.g., `expenses.css` next to `ExpensesPage.jsx`). Global UI primitives share CSS in `styles/components.css`.
* **Dark Theme:** The application supports dark mode natively via the `[data-theme="dark"]` attribute on the `<html>` or `<body>` tag. Override specific token variables in `styles/themes.css` for dark mode instead of hardcoding dark colors in component styles.
* **Responsive Design:** Use standard CSS media queries (`@media (max-width: 768px) { ... }`) defined locally or in `styles/layout.css` to manage breakpoints.

---

## 8. Supabase Conventions

All interactions with the database and backend services must go through the centralized client.

* **Singleton Client:** Always import the Supabase client from the `lib` directory:
  ```javascript
  import { supabase } from '../../lib/supabase';
  ```
* **Write Engine (`writeRows.js`):** We use a custom, schema-tolerant write engine for insertions and updates. This utility gracefully handles PostgREST errors like `204` (No Content) and `23502` (Not Null Violation) through automated retries and fallback mechanisms. Always use `writeRows` when modifying records instead of calling `supabase.from().insert()` directly.
* **Storage:** When retrieving files from Supabase Storage, always generate signed URLs rather than exposing public bucket URLs.
* **Error Handling:** Always catch and log PostgREST errors appropriately. Provide user-friendly feedback via UI toast notifications when data mutations fail.

---

## 9. Code Hygiene Standards

Maintainability is a core goal. Please adhere to these guidelines:

* **File Size:** Keep files under **400 lines**. If a file grows larger, break it down into smaller, composable pieces.
* **Exports:** 
  * Use **default exports** for React Page Components (e.g., `export default function ClientsPage() { ... }`).
  * Use **named exports** for all utility functions, pure logic, and helpers (e.g., `export const formatCurrency = () => { ... }`).
* **Barrel Files:** Do **not** use barrel files (`index.js` files that re-export modules). Import directly from the specific file.
* **Linting:** We enforce code quality using `oxlint`. Run the linter before pushing code:
  ```bash
  npm run lint
  ```

---

## 10. Dependency Management

* **Zero-Dep Preference:** We heavily prefer zero-dependency solutions. For example, we use our custom `src/lib/xlsx.js` instead of installing libraries like `SheetJS`.
* **Adding Dependencies:** If a new dependency is absolutely necessary, it **must** be justified in your Pull Request. 
* **Bundle Impact:** Check the bundle size impact of any new dependency.
* **CSS Frameworks:** We do not use external CSS frameworks (no Tailwind, Bootstrap, MUI, etc.). Stick to the internal design system and Vanilla CSS.

---

## 11. Scripts & Utilities

The `scripts/` directory at the project root contains Node.js CLI tools designed to aid developer workflows. 

* **Purpose:** These scripts handle tasks that are outside the scope of the React application, such as generating PDF reports locally, running database sanity checks, or testing S3/Storage connectivity.
* **Usage:** Scripts should be run from the root directory using Node.
  ```bash
  node scripts/check-db-consistency.js
  ```
Do not import anything from `scripts/` into the `src/` directory.

---

## 12. Pre-Merge Checklist

Before opening a PR or merging code, ensure you have completed the following checklist:

- [ ] **Build Passes:** Running `npm run build` succeeds without errors.
- [ ] **Lint Passes:** Running `npm run lint` yields zero warnings or errors.
- [ ] **No `console.log`:** All debugging statements have been removed or replaced with proper logging mechanisms.
- [ ] **Feature-Scoped CSS:** New CSS does not pollute the global namespace.
- [ ] **Responsive Check:** The UI renders correctly on mobile (e.g., 375px width) and desktop screens.
- [ ] **Dark Theme Check:** The new feature looks correct when `[data-theme="dark"]` is active.
- [ ] **Zero Dep Rule Respected:** No unnecessary npm packages were introduced.

---
*Document last updated: September 2026*
