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

- WhatsApp inbox: Clear chat, Delete chat, Block and Unblock, from the chat
  header and Contact info, each confirmed first and recorded with who did it.
  Clearing and deleting hide the thread for the team (the customer keeps
  their copy); blocking uses Meta's block list. New permissions
  `inbox.delete` and `inbox.block`. The API also accepts replies that quote a
  message, reactions, forwarding, pins, personal stars and deleting one
  message; their controls in the thread are still to come.

- Live Assist: with an employee's OK, a colleague who may help them sees their
  Dikho tab live, points at and highlights things, and suggests pages. No
  remote control and nothing recorded. Plus "Ask for help", which tells the
  people who can help. See ADR 0008.

- Live Assist chat: messages under the employee's banner with quick replies,
  numbered notes the helper pins beside a button or field (done when the
  employee clicks it), and a chat column beside the helper's view. Not saved.
  Colleagues at the same level can now help each other, "Ask for help" can go
  to one chosen person, and nobody can be in two sessions at once.
- The staff welcome WhatsApp template is configured and the sender matches
  the approved template's real shape before sending.

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

- WhatsApp inbox bubbles are WhatsApp-sized: one line of text is 29px tall
  instead of 54px, the time sits on the last line, and the thread uses a
  doodle wallpaper drawn for Dikho instead of a dot grid.
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
