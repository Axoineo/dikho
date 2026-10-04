# WhatsApp OTP Sign-In

Last updated: 2026-10-04

Staff may sign in with a one-time code delivered through an approved WhatsApp
authentication template. Supabase remains responsible for OTP generation,
expiry, verification and session issuance; the API Worker only replaces the SMS
delivery channel.

## Flow

```text
Browser -- signInWithOtp(phone, shouldCreateUser:false) --> Supabase Auth
Supabase -- signed Send SMS hook with OTP --> API Worker
API Worker -- verify raw-body HMAC --> WhatsApp provider
User -- code --> Browser -- verifyOtp(type:sms) --> Supabase Auth session
```

Only phone numbers already provisioned in Supabase Auth can request a code.
`shouldCreateUser: false` prevents self-registration. Provisioning a user is
therefore a security-sensitive administrator action because the current app
does not yet have fine-grained roles.

## Security properties

- The Worker verifies the hook's timestamped Standard Webhooks signature over
  the exact raw request body.
- Requests outside the accepted timestamp window are rejected.
- OTP values are passed only to the provider call and are not logged.
- Meta credentials and the hook signing secret stay in the Worker secret store.
- The client verifies the code with Supabase; the Worker cannot issue a session.
- Unknown users receive no code because Supabase does not invoke the hook.

CORS does not authenticate the hook. Signature verification is the security
boundary.

## Provider setup

Create an approved authentication-category template containing the OTP and the
expected copy-code button. Record only its non-secret name and language in
configuration. Never place provider tokens or application secrets in docs.

## Supabase setup

1. Enable phone confirmations.
2. Keep the OTP length synchronized with the approved template.
3. Choose an expiry long enough for delivery and app switching while remaining
   appropriately short-lived.
4. Configure the HTTPS Send SMS hook to:

   ```text
   <api-origin>/api/auth/whatsapp-otp
   ```

5. Copy the generated signing secret directly into the Worker secret store.
   Do not paste it into source, Markdown, an issue or chat.

The external provider fields for a built-in SMS service are not needed when the
Send SMS hook owns delivery.

## Worker configuration

Set secret values interactively:

```bash
npx wrangler secret put SUPABASE_SEND_SMS_HOOK_SECRET -c wrangler.api.jsonc
npx wrangler secret put WHATSAPP_ACCESS_TOKEN -c wrangler.api.jsonc
npx wrangler secret put WHATSAPP_APP_SECRET -c wrangler.api.jsonc
```

Set template name/language and other non-secret identifiers through the reviewed
environment configuration. Deploy with:

```bash
npm run deploy:api
```

Do not run commands that print existing secret values for inclusion in a ticket
or deployment transcript.

## User provisioning

Add or remove allowed users through the Supabase administrator interface or the
repository's local administrator script. Use a test number in non-production.

Example shape only:

```bash
SUPABASE_URL=<project-url> SUPABASE_SERVICE_ROLE_KEY=<secret> \
  node scripts/add-auth-user.mjs <e164-phone>
```

This inline form can remain in shell history, so prefer temporary environment
injection or an approved secret manager when operating on a real environment.
Never share the resulting command history. The service-role key is fully
privileged and must never enter the browser.

Removing a Supabase Auth user prevents new OTP requests. For urgent revocation,
also revoke active sessions using the provider's administrator controls.

## Validation

- Authorized test user receives a code and can sign in.
- Unknown phone receives no code and cannot create an account.
- Invalid/expired code does not create a session.
- Replayed or invalid hook signature receives 401.
- A stale hook timestamp is rejected.
- Logs contain neither OTP nor authorization/signature values.
- Rate limits prevent repeated OTP abuse without revealing user existence more
  than the current product flow requires.

## Troubleshooting safely

- “Not authorized” normally means the user was not provisioned or the phone is
  stored in a different normalized form.
- A signature-rejected event means hook configuration and Worker configuration
  disagree, or the request is invalid/stale. Compare configuration by rotating
  and replacing the secret; do not log both values.
- A provider send failure may indicate template, language, opt-in or account
  configuration. Record only the provider error code and sanitized message.
- Never copy a raw hook body into an issue because it contains an OTP and phone.

## Related documentation

- [Architecture](ARCHITECTURE.md)
- [Deployment](DEPLOYMENT.md)
- [Security audit](SECURITY-AUDIT.md)
