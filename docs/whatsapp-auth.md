# WhatsApp login (template `dikho_auth`)

Staff can sign in to the dashboard with a one-time code delivered over WhatsApp,
alongside the existing email login. Only pre-approved phone numbers can get in.

## How it works

Supabase still owns the OTP (generation, expiry, verification, session/JWT). We
only change the **delivery channel** to WhatsApp using a Supabase **"Send SMS"
auth hook** pointed at the `dikho-api` Worker.

```
Login page  ──signInWithOtp({ phone })──▶  Supabase Auth
                                             │  generates the code
                    Send-SMS hook (HMAC) ◀───┘
   dikho-api Worker  /api/auth/whatsapp-otp
        │  verifies signature, sends the code via `dikho_auth`
        ▼
   WhatsApp message  ──user types code──▶  verifyOtp({ phone, token, type:'sms' })
                                             └─▶ real Supabase session
```

The whitelist is enforced by `shouldCreateUser: false` on the client: Supabase
refuses to generate a code — and never calls the hook — for a phone that is not
already a Supabase Auth user. Unknown numbers get **no** message and **no** login.

## One-time setup

### 1. Meta — the template

Create/confirm `dikho_auth` as an **Authentication**-category template,
**Approved**, language `en` (if it's `en_US`, set `WHATSAPP_AUTH_TEMPLATE_LANG`
to `en_US`), with the **copy-code** button. The Worker already holds
`WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.

### 2. Supabase — enable phone auth + the hook

Works on the **Free plan** — the Send SMS hook is available on Free (no Twilio,
no paid upgrade). Two *different* screens are involved:

1. **Authentication → Providers → Phone:**
   - **Enable phone confirmations** = ON.
   - **SMS OTP Length** = `6` (must match the `dikho_auth` template).
   - **SMS OTP Expiry** = `300`–`600` seconds. The default **60s is too short**
     for WhatsApp — delivery plus app-switching routinely blows past it and the
     user sees "expired".
   - **Leave the Twilio fields blank.** The hook (step 2) overrides the built-in
     provider, so no Twilio account is required. Ignore "Twilio Content SID (For
     WhatsApp Only)" — that is Supabase's *native Twilio-WhatsApp* path (paid,
     separate template), which we are deliberately not using.
   - The "SMS Message" text (`Your code is {{ .Code }}`) is unused once the hook
     is on — the code is delivered through the WhatsApp template instead.
2. **Authentication → Hooks → Send SMS hook → Enable → HTTPS** (this is a
   separate page from Providers):
   URL: `https://dikho-api.fineeurox.workers.dev/api/auth/whatsapp-otp`
   Copy the generated secret (looks like `v1,whsec_…`) → that is
   `SUPABASE_SEND_SMS_HOOK_SECRET` in step 3.

### 3. Worker — secrets

Store everything as **secrets**, never plaintext vars (a deploy silently wipes
remote-only vars but never touches secrets):

```bash
npx wrangler secret put SUPABASE_SEND_SMS_HOOK_SECRET -c wrangler.api.jsonc
npx wrangler secret put WHATSAPP_AUTH_TEMPLATE_NAME -c wrangler.api.jsonc   # dikho_auth
npx wrangler secret put WHATSAPP_AUTH_TEMPLATE_LANG -c wrangler.api.jsonc   # en
```

Then deploy: `npm run deploy:api` (Worker) and `npm run deploy` (dashboard).

## Adding / removing users (the whitelist)

Only numbers that exist as Supabase Auth users can log in.

**Add — dashboard:** Authentication → Users → **Add user** → enter the phone in
E.164 (`+919812345678`) → check **Auto Confirm User** → create.

**Add — script:**

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/add-auth-user.mjs +919812345678
```

(The service-role key is admin-level — run locally only, never commit or ship it.)

**Remove access:** delete that user in Supabase (Authentication → Users). They
can no longer request a code.

## Troubleshooting

- **"This number isn't authorized"** on the login page → the phone isn't a
  Supabase user yet. Add it (above). Confirm the stored phone is exact E.164.
- **No WhatsApp message, but no client error** → check `npx wrangler tail
  dikho-api`. A `signature_rejected` line means the hook secret in the Worker
  doesn't match the one Supabase generated; re-copy it. A `send_failed` line
  carries Meta's error code (e.g. template name/language mismatch, or the number
  isn't reachable / hasn't opted in).
- **Meta rejects the button component** → the `dikho_auth` template was created
  without a copy-code button. Drop the `button` component in
  `sendAuthTemplate` (`src/api/services/whatsapp/graph.js`) and keep only `body`.
