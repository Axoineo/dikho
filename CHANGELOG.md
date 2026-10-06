# Changelog

This file records notable repository changes intended for operators,
contributors and future public-release adopters. The project has not made a
public release and does not yet promise semantic-version compatibility.

The repository and software are currently proprietary property of Dikho Global
Media LLP. No public license or redistribution permission is granted.

Do not include credentials, private resource identifiers, production data,
incident details or unreleased vulnerability exploitation instructions here.

## Unreleased

### Added

- User Management: staff profiles, departments and teams, permission
  templates, per-person permission overrides, system roles and developer
  levels, per-action permissions enforced by RLS and the API, an append-only
  audit log, session list with approximate sign-in location, "Active now",
  force sign-out, suspend and archive, welcome message on add, and a theme
  preference saved per person. See ADR 0007.

- Canonical repository and nested `AGENTS.md` guidance for AI-assisted work.
- Product, invariant, architecture, database, testing, deployment, branding,
  configuration, permissions, upgrade and security-audit documentation.
- A visual system handbook with trust-boundary diagrams and synthetic UI
  screenshots.
- Isolated tests for session verification, Turnstile verification, webhook
  signatures and protected-media tickets.

### Changed

- The safe `npm run check` command now runs lint, isolated tests, the production
  build and the high-signal secret scan.
- Documentation now distinguishes the production Cloudflare Pages SPA from the
  unused standalone SPA Worker deployment command.

### Security

- Documented open authorization, public-upload, Storage-policy and resource
  exhaustion findings in `docs/SECURITY-AUDIT.md`; documentation does not mark
  those findings resolved.

## Maintenance rules

- Add user-visible behavior, schema, configuration, security and operational
  changes under `Unreleased` in the same change that introduces them.
- Label removals and breaking changes explicitly and link their upgrade steps.
- Move entries into a dated version only when an actual release is approved.
- Describe outcomes, not secret values or private deployment identifiers.
- A changelog entry is not evidence that a change was deployed; production
  state must be verified independently.
