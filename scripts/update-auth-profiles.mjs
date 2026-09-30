#!/usr/bin/env node
// Sets display names (and optionally a login phone / avatar) on existing
// Supabase Auth users. Companion to add-auth-user.mjs.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/update-auth-profiles.mjs            # dry run, changes nothing
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/update-auth-profiles.mjs --apply    # actually writes
//
// Why two metadata keys per name: the Studio "Display name" column reads
// display_name, while this app reads full_name (src/components/Sidebar.jsx and
// src/features/sales-orders/salesOrderHelpers.js). Setting only one leaves the
// other surface showing an email prefix, so we set both to the same string.
//
// The service-role key is a full-admin key. Never commit it, never ship it to
// the browser or a Worker; only run this locally with the key in your env.

import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')

// An avatar's URL is just the user's own id, so there is nothing to configure:
// the script probes /api/avatars/<id> and links it only once a photo is actually
// uploaded there. Re-run it after uploading and the avatars fill themselves in.
const API_BASE = process.env.API_BASE || 'https://dikho-api.fineeurox.workers.dev'

const TARGETS = [
  { email: 'anil@dikho.in',        name: 'Anil S. Rathod',  phone: null },
  { email: 'fineeurox@gmail.com',  name: 'Suraj R. Rathod', phone: null },
  { email: 'rakhi@dikho.in',       name: 'Rakhi S. Rathod', phone: '+918866228292' },
]

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment first.')
  process.exit(1)
}

for (const t of TARGETS) {
  if (t.phone && !/^\+\d{8,15}$/.test(t.phone)) {
    console.error(`"${t.phone}" is not a valid E.164 phone (e.g. +919812345678).`)
    process.exit(1)
  }
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Page through rather than assuming everyone fits on page one.
const e164 = (p) => (p ? `+${String(p).replace(/^\+/, '')}` : null)

const all = []
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) {
    console.error(`✗ Could not list users: ${error.message}`)
    process.exit(1)
  }
  all.push(...data.users)
  if (data.users.length < 200) break
}

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${all.length} users in the project\n`)

let failed = 0
for (const t of TARGETS) {
  const user = all.find((u) => u.email?.toLowerCase() === t.email.toLowerCase())
  if (!user) {
    console.error(`✗ ${t.email}: no such user — skipped`)
    failed++
    continue
  }

  // A confirmed phone is a login credential here, so refuse to silently steal
  // one that already belongs to somebody else.
  if (t.phone) {
    const holder = all.find((u) => u.id !== user.id && e164(u.phone) === t.phone)
    if (holder) {
      console.error(`✗ ${t.email}: ${t.phone} is already on ${holder.email || holder.id} — skipped`)
      failed++
      continue
    }
  }

  const meta = user.user_metadata || {}
  const attrs = { user_metadata: { ...meta, full_name: t.name, display_name: t.name } }

  const avatarUrl = `${API_BASE}/api/avatars/${user.id}`
  const hasAvatar = await fetch(avatarUrl).then((r) => r.ok).catch(() => false)
  if (hasAvatar) attrs.user_metadata.avatar_url = avatarUrl

  if (t.phone) {
    attrs.phone = t.phone
    attrs.phone_confirm = true
  }

  const was = [
    `name ${meta.full_name ? `"${meta.full_name}"` : '(unset)'} -> "${t.name}"`,
    t.phone ? `phone ${e164(user.phone) || '(none)'} -> ${t.phone}` : null,
    hasAvatar ? 'avatar -> linked' : `avatar -> NOTHING at /api/avatars/${user.id}`,
  ].filter(Boolean).join(', ')

  if (!APPLY) {
    console.log(`· ${t.email}: ${was}`)
    continue
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, attrs)
  if (error) {
    console.error(`✗ ${t.email}: ${error.message}`)
    failed++
    continue
  }
  console.log(`✓ ${t.email}: ${was}`)
}

if (!APPLY) console.log('\nNothing was written. Re-run with --apply to commit these changes.')
process.exit(failed ? 1 : 0)
