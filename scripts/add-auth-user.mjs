#!/usr/bin/env node
// Adds (or confirms) a Supabase Auth user by phone number, which is what makes
// that number able to log in — the dashboard requests OTPs with
// shouldCreateUser:false, so only users that already exist here can sign in.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/add-auth-user.mjs +919812345678 [email@optional]
//
// The service-role key is a full-admin key. Never commit it, never ship it to
// the browser or a Worker; only run this locally with the key in your env.

import { createClient } from '@supabase/supabase-js'

const [, , phoneArg, emailArg] = process.argv

if (!phoneArg) {
  console.error('Usage: node scripts/add-auth-user.mjs <+E164phone> [email]')
  process.exit(1)
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment first.')
  process.exit(1)
}

// E.164 with leading "+", 8–15 digits.
const phone = phoneArg.trim()
if (!/^\+\d{8,15}$/.test(phone)) {
  console.error(`"${phone}" is not a valid E.164 phone (e.g. +919812345678).`)
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const attrs = { phone, phone_confirm: true }
if (emailArg) {
  attrs.email = emailArg.trim()
  attrs.email_confirm = true
}

const { data, error } = await admin.auth.admin.createUser(attrs)

if (error) {
  // Already-registered is not a failure worth a non-zero exit for a re-run.
  if (/already been registered|already exists/i.test(error.message)) {
    console.log(`✓ ${phone} is already an authorized user — nothing to do.`)
    process.exit(0)
  }
  console.error(`✗ Failed to add ${phone}: ${error.message}`)
  process.exit(1)
}

console.log(`✓ Added ${phone} (user id ${data.user.id}). They can now log in via WhatsApp.`)
