#!/usr/bin/env node
// Makes the FIRST Owner of a fresh installation: creates (or finds) the
// sign-in account for a phone number, then gives it an Owner staff record
// through public.um_bootstrap_owner. That function refuses once any active
// Owner exists, so this cannot be used to add or promote anyone later:
// everyone after the first Owner is added in the dashboard, under
// User Management, where every change is checked and audited.
// See docs/runbooks/staff-access.md and docs/decisions/0007-user-management-and-permissions.md.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/add-auth-user.mjs +919812345678 [email@optional] --owner "Full Name"
//
// The service-role key is a full-admin key. Never commit it, never ship it to
// the browser; only run this locally with the key in your environment.

import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
let fullName = null
const positional = []
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--owner') fullName = args[++i]
  else positional.push(args[i])
}
const [phoneArg, emailArg] = positional

const usage = 'Usage: node scripts/add-auth-user.mjs <+E164phone> [email] --owner "Full Name"'
if (!phoneArg || !fullName) {
  console.error(usage)
  console.error('To add anyone other than the first Owner, use User Management in the dashboard.')
  process.exit(1)
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment first.')
  process.exit(1)
}

// E.164 with leading "+", 8-15 digits.
const phone = phoneArg.trim()
if (!/^\+\d{8,15}$/.test(phone)) {
  console.error(`"${phone}" is not a valid E.164 phone (e.g. +919812345678).`)
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const attrs = { phone, phone_confirm: true, user_metadata: { full_name: fullName } }
if (emailArg) {
  attrs.email = emailArg.trim()
  attrs.email_confirm = true
}

let userId
const { data, error } = await admin.auth.admin.createUser(attrs)
if (!error) {
  userId = data.user.id
} else if (/already been registered|already exists/i.test(error.message)) {
  // Existing account: find it by phone. Supabase stores phones without "+".
  const digits = phone.slice(1)
  for (let page = 1; !userId; page += 1) {
    const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (listError) {
      console.error(`Could not look up ${phone}: ${listError.message}`)
      process.exit(1)
    }
    userId = listed.users.find((user) => user.phone === digits)?.id
    if (listed.users.length < 200) break
  }
  if (!userId) {
    console.error(`${phone} is registered but could not be found.`)
    process.exit(1)
  }
} else {
  console.error(`Failed to create the account for ${phone}: ${error.message}`)
  process.exit(1)
}

const { error: ownerError } = await admin.rpc('um_bootstrap_owner', { p_user: userId, p_full_name: fullName })
if (ownerError) {
  console.error(`Could not make ${phone} the Owner: ${ownerError.message}`)
  process.exit(1)
}
console.log(`${fullName} (${phone}) is now the Owner. Sign in with this number and add everyone else from User Management.`)
