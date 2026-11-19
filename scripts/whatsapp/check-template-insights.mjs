#!/usr/bin/env node
//
// Read-only check: does Meta give link-button taps for this WhatsApp Business
// account? Those come from template insights (`template_analytics`), which only
// answer once insights are switched on for the account. The dashboard shows link
// taps only when they answer, so this tells you before deploying what it will show.
//
// It reads; it never switches insights on or changes anything at Meta. The token is
// read from the environment and is never printed.
//
// Usage (the token is typed without echo, so it stays out of shell history):
//   read -rs WHATSAPP_ACCESS_TOKEN && export WHATSAPP_ACCESS_TOKEN
//   WHATSAPP_WABA_ID=<WhatsApp Business account id> node scripts/whatsapp/check-template-insights.mjs
//
// Looks at the last 90 days (Meta's limit) for every template with a website button.

import { templateInsights } from '../../src/api/services/whatsapp/analytics.js'

const GRAPH = 'https://graph.facebook.com/v21.0'
const env = { WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN, WHATSAPP_WABA_ID: process.env.WHATSAPP_WABA_ID }

if (!env.WHATSAPP_ACCESS_TOKEN || !/^\d{1,30}$/.test(env.WHATSAPP_WABA_ID ?? '')) {
  console.error('Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_WABA_ID (digits) first. See the comment at the top of this file.')
  process.exit(2)
}

async function graph(path) {
  const res = await fetch(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`Meta answered ${res.status}${body?.error?.code ? ` (code ${body.error.code})` : ''}: ${String(body?.error?.message ?? '').slice(0, 200)}`)
  return body ?? {}
}

const hasWebsiteButton = (template) => (template.components ?? []).some(
  (part) => part.type === 'BUTTONS' && (part.buttons ?? []).some((button) => button.type === 'URL'),
)

const templates = []
let page = await graph(`${env.WHATSAPP_WABA_ID}/message_templates?fields=id,name,language,status,components&limit=100`)
for (let i = 0; i < 10; i += 1) {
  templates.push(...(page.data ?? []))
  const next = page.paging?.next
  if (!next || !String(next).startsWith(`${GRAPH}/`)) break
  page = await graph(String(next).slice(GRAPH.length + 1))
}

const withLinks = templates.filter(hasWebsiteButton)
console.log(`${templates.length} templates, ${withLinks.length} with a website button.`)
if (!withLinks.length) {
  console.log('No template has a website button, so there are no link taps to count.')
  process.exit(0)
}

const today = new Date()
const lastDay = today.toISOString().slice(0, 10)
const firstDay = new Date(today.getTime() - 89 * 86400000).toISOString().slice(0, 10)
let any = false
for (let i = 0; i < withLinks.length; i += 10) {
  const batch = withLinks.slice(i, i + 10)
  const result = await templateInsights(env, { ids: batch.map((t) => String(t.id)), firstDay, lastDay, now: today })
  if (!result.available) {
    console.log(`\nTemplate insights: OFF, or not available to this token.\nMeta said: ${result.reason}`)
    console.log('The dashboard will hide link taps and show quick-reply taps only.')
    process.exit(0)
  }
  for (const t of batch) {
    const entry = result.byId[String(t.id)]
    const taps = entry?.linkTaps ?? 0
    if (taps) any = true
    const buttons = (entry?.links ?? []).map((link) => `${link.label} ${link.count}`).join(', ')
    console.log(`  ${t.name} (${t.language}): ${taps} link taps${buttons ? `  [${buttons}]` : ''}`)
  }
}
console.log(`\nTemplate insights: ON. ${any ? 'Meta returned link taps.' : 'Meta answered, with no link taps in the last 90 days.'}`)
console.log('The dashboard will show link taps for these templates.')
