# Security Policy

Security issues involving authentication, authorization, customer/vendor data,
financial records, messaging, public forms, file storage or infrastructure are
in scope for private reporting.

## Supported versions

Only the current reviewed deployment and the active main branch receive
security fixes. Older releases, abandoned branches and local forks are not
supported.

## Report privately

Do not disclose a suspected vulnerability through a public issue, discussion,
pull request, commit message or shared chat. Contact the project administrator
through the organization's approved private security channel.

Include:

- the affected endpoint, component, policy or configuration;
- reproducible steps using test data;
- expected and observed behavior;
- the practical impact and prerequisites;
- a minimal proof of concept, if safe;
- a suggested mitigation, if known.

Do not include live credentials, OTPs, signed URLs, production documents,
message contents or personal data. If evidence contains sensitive information,
ask the administrator for an approved transfer method first.

## Response process

Maintainers will aim to acknowledge the report, validate impact, prioritize a
fix, coordinate rollout and notify the reporter when remediation is available.
Timing depends on severity and operational risk. Allow reasonable remediation
time before public disclosure.

## In scope

- account takeover, OTP bypass and session flaws;
- missing authorization or cross-user/cross-organization access;
- unsafe RLS, Storage or service-role usage;
- webhook forgery or replay with practical impact;
- injection, XSS, request forgery and path traversal;
- unauthorized message sending or quota/spend abuse;
- upload abuse, malicious file handling and storage exhaustion;
- disclosure of credentials, private media or business data;
- meaningful security misconfiguration in Cloudflare or Supabase;
- dependency vulnerabilities with a reachable application impact.

## Out of scope without demonstrated impact

- unsupported historical versions;
- purely theoretical findings with no reachable path;
- missing headers that do not create an exploitable condition by themselves;
- social engineering or spam against contributors;
- third-party platform issues outside this project's control;
- denial-of-service or high-volume testing performed without written approval.

Never test against production in a way that changes data, sends messages,
consumes paid quota, uploads files, degrades service or accesses another
person's information without explicit authorization.

## Credential classification

The following are secrets and must exist only in approved server-side secret
stores:

- Supabase service-role credentials;
- Meta access tokens and application secrets;
- webhook signing and verification secrets;
- Turnstile secret keys;
- third-party API keys and mail provider credentials;
- private keys, database passwords and recovery tokens;
- OTPs, session tokens and signed media URLs.

Supabase publishable keys, public site keys, API origins, template names and
resource names are not authentication secrets, but still avoid unnecessary
environment-specific values in documentation. Public identifiers never replace
RLS, signature verification or authorization.

## Safe secret handling

- Use provider secret stores and interactive secret-entry commands.
- Use placeholder values such as `<secret>` in documentation and examples.
- Do not put secrets in CLI arguments when they may be retained in history.
- Do not print secret-store values to logs or pipe them into copied output.
- Keep production secrets out of local development when possible.
- Restrict who can read, rotate and deploy each credential.
- Rotate immediately if a secret enters Git, logs, chat, screenshots or an
  unapproved device. Removing it from the latest commit is not remediation.

## Secure engineering baseline

### Authentication and authorization

- Supabase validates identity; application and RLS rules decide permission.
- `shouldCreateUser: false` keeps OTP sign-in invite-only but is not a role
  system.
- Sensitive routes require server-side role checks in addition to a valid JWT.
- Session limits in the UI are defense in depth; server tokens remain subject
  to their actual expiry and revocation behavior.

### Public endpoints

- Verify Turnstile server-side, including expected action and hostname.
- Treat Turnstile as bot friction, not a hard volume or spend ceiling.
- Add global budgets/idempotency for operations that call paid APIs or send
  messages.
- Fail closed when verification configuration is absent.

### Webhooks

- Verify signatures over the exact raw bytes before JSON parsing.
- Reject stale signed requests where the protocol supplies a timestamp.
- Store/process events idempotently because providers retry deliveries.
- Never log a complete signed payload containing private content.

### Data and files

- Enable RLS and use least-privilege policies for every exposed table.
- Scope Storage access to the minimum organization, record, path and action.
- Validate upload size, type and content; bound archive decompression.
- Use private objects and short-lived access URLs/tickets.
- Encrypt in transit and use provider-managed encryption at rest.

### Logging and errors

- External errors must not reveal stack traces, SQL, credential state or raw
  upstream bodies.
- Logs must redact secrets and minimize phone numbers, email addresses,
  documents and message content.
- Define log access and retention in the hosting platforms.

## Known risks and remediation

The current repository audit is tracked in
[docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md). The highest priorities are:

1. move anonymous vendor-document upload behind server-side verification;
2. replace broad vendor-document policies with scoped authorization;
3. add role/organization authorization beyond a valid authenticated session;
4. add strict resource limits to file import and media upload paths;
5. add browser security headers and automated security tests.

Documentation updates do not close these findings. A finding is complete only
after code/configuration changes are deployed and their effective behavior is
verified.

## Required checks

```bash
npm run check
npm audit --omit=dev
```

Also review effective production RLS and Storage policies. A repository schema
snapshot may differ from live state.

Last updated: 2026-10-04.
