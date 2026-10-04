# 0001: Separate SPA Hosting from the API Worker

Status: Accepted
Date: 2026-10-04

## Context

The React SPA needs static asset routing and public browser configuration. The
application API needs secrets, D1/R2 bindings, rate limits, provider access and
scheduled work. Combining them makes it easier to attach privileged bindings to
code whose main job is serving public assets and makes deployments harder to
reason about.

## Decision

Serve the SPA from a Cloudflare Pages project connected to this repository,
which builds and deploys every push to `main`. Run the API as a separate
Cloudflare Worker with its own configuration (`wrangler.api.jsonc`) and entry
point (`src/api/worker.js`). The browser calls the API through an explicit
public origin protected by CORS plus endpoint authentication.

## Consequences

- Privileged bindings and secrets remain on the API Worker. The Pages project
  must hold only public build settings (`VITE_*`).
- SPA and API deploy independently: a push to `main` releases the SPA, and
  `npm run deploy:api` releases the API. Building or pushing the SPA does not
  deploy API changes, and vice versa.
- Because a push to `main` is a production release of the SPA, changes must be
  verified locally before they are pushed.
- Cross-origin configuration must be maintained deliberately.
- `wrangler.jsonc` and `src/worker.js` still describe a standalone SPA Worker.
  Production does not use it: `npm run deploy` publishes that Worker without
  changing the live site, so it must not be used as a release step.

## Alternatives considered

- One Worker serving assets and API: fewer deployment units but weaker
  separation and greater configuration coupling.
- A dedicated SPA Worker (`wrangler.jsonc`, `src/worker.js`): gives the same
  separation and remains in the repository, but production does not use it.
- Direct browser calls for every backend operation: unsuitable for service-role
  work, secret integrations and D1/R2 access.

## Verification

- The Pages build environment contains no API secrets.
- API bindings exist only in the API configuration.
- Protected API calls reject missing/invalid sessions.
- Production origin allowlists contain only intended browser origins.
- The active production Pages deployment is the latest reviewed commit on
  `main`.
