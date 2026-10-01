// Corporate-gifting lead confirmation — the automatic WhatsApp message sent
// after someone submits the public /corporategifting form.
//
// Two entry points, deliberately split by the 7-minute delay between them:
//   enqueueCgLeadConfirmation()   <- POST /api/public/cg-lead (routes/public)
//   dispatchDueCgLeadConfirmations() <- the every-minute cron (worker.js)
//
// A Worker cannot hold a request open for 7 minutes, so the intent is
// persisted in `cg_lead_outbox` (migration 0010) and a later cron invocation
// does the sending. Everything that talks to Meta lives on the dispatch side.
//
// Guarantee this module is responsible for: ONE SUCCESSFUL MESSAGE PER NUMBER
// PER 7 DAYS, no matter how many times that number submits the form. See
// claimSendSlot/releaseSendSlot for how a failed send is kept from consuming a
// number's weekly slot.

import { fetchApprovedTemplates, sendTemplateMessage } from './graph.js'
import { buildComponents, sanitizeParam, templateTokens } from '../../../lib/templateVars.js'
import { logEvent, logError } from '../../utils/logger.js'

const DEFAULT_TEMPLATE_NAME = 'client_conformation_'
const DEFAULT_TEMPLATE_LANG = 'en'

// Minutes between the form submission and the message. Overridable via
// wrangler.api.jsonc so the delay can be tuned without a code change.
const DEFAULT_DELAY_MINUTES = 7

// One successful message per number per this many days. A product rule rather
// than an infra tunable, so it is a constant and not an env var.
const COOLDOWN_DAYS = 7

// Rows claimed per cron run. Each dispatch costs one Meta subrequest (plus at
// most one cached template fetch per isolate), and the Workers FREE plan caps
// external subrequests at 50 per invocation — see wrangler.api.jsonc. 20 is
// well inside that, and at one run per minute it is far above the daily send
// budget anyway, so it is never the limiting factor in practice.
const DISPATCH_LIMIT = 20

// A queued message older than this is dropped rather than sent. Without it, a
// multi-hour outage would end with the backlog arriving all at once, long
// after it stopped being relevant to the lead.
const STALE_AFTER_HOURS = 24

function templateName(env) {
  return env.WHATSAPP_CG_LEAD_TEMPLATE_NAME || DEFAULT_TEMPLATE_NAME
}

function templateLanguage(env) {
  return env.WHATSAPP_CG_LEAD_TEMPLATE_LANG || DEFAULT_TEMPLATE_LANG
}

function delayMinutes(env) {
  const raw = Number(env.WHATSAPP_CG_LEAD_DELAY_MINUTES)
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_DELAY_MINUTES
}

/* ── Enqueue (request path) ─────────────────────────────────────────────── */

/**
 * Schedules the confirmation for `lead`, or does nothing if this number does
 * not need one. Best-effort: called via waitUntil, so a failure here must never
 * surface to the visitor, whose lead is already saved in Supabase.
 */
export async function enqueueCgLeadConfirmation(env, lead) {
  const phone = `${lead?.country_code ?? ''}${lead?.mobile ?? ''}`.replace(/\D/g, '')
  const name = sanitizeParam(lead?.name)
  if (!phone || !name) return

  if (!env.DB) {
    logEvent('cg_lead.whatsapp_skipped', { reason: 'no_db_binding' })
    return
  }

  const template = templateName(env)

  try {
    // Two cheap read-only gates before writing a queue row. Neither is the
    // actual guarantee — claimSendSlot at dispatch time is — but together they
    // keep repeat submissions from piling up rows that would only be discarded
    // 7 minutes later.
    const alreadyQueued = await env.DB.prepare(
      `SELECT 1 FROM cg_lead_outbox
       WHERE phone = ?1 AND template_name = ?2 AND status IN ('pending', 'sending')
       LIMIT 1`,
    ).bind(phone, template).first()
    if (alreadyQueued) {
      logEvent('cg_lead.whatsapp_already_queued', { phone, templateName: template })
      return
    }

    const recentlySent = await env.DB.prepare(
      `SELECT 1 FROM template_send_cooldowns
       WHERE phone = ?1 AND template_name = ?2
         AND last_sent_at > datetime('now', ?3)
       LIMIT 1`,
    ).bind(phone, template, `-${COOLDOWN_DAYS} days`).first()
    if (recentlySent) {
      logEvent('cg_lead.whatsapp_cooldown_skip', { phone, templateName: template, at: 'enqueue' })
      return
    }

    const minutes = delayMinutes(env)
    await env.DB.prepare(
      `INSERT INTO cg_lead_outbox (phone, name, template_name, scheduled_at)
       VALUES (?1, ?2, ?3, datetime('now', ?4))`,
    ).bind(phone, name, template, `+${minutes} minutes`).run()

    logEvent('cg_lead.whatsapp_queued', { phone, templateName: template, delayMinutes: minutes })
  } catch (err) {
    logError('cg_lead.whatsapp_enqueue_failed', err)
  }
}

/* ── Dispatch (cron path) ───────────────────────────────────────────────── */

/**
 * Sends every queued confirmation whose delay has elapsed. Invoked once a
 * minute by the cron in worker.js.
 */
export async function dispatchDueCgLeadConfirmations(env) {
  if (!env.DB) return

  // Drop anything that sat in the queue through an outage. One bounded
  // statement; writes nothing when there is nothing stale.
  try {
    await env.DB.prepare(
      `UPDATE cg_lead_outbox
       SET status = 'skipped', skip_reason = 'stale'
       WHERE status = 'pending' AND scheduled_at <= datetime('now', ?1)`,
    ).bind(`-${STALE_AFTER_HOURS} hours`).run()
  } catch (err) {
    logError('cg_lead.outbox_stale_sweep_failed', err)
  }

  let due
  try {
    const result = await env.DB.prepare(
      `SELECT id, phone, name, template_name
       FROM cg_lead_outbox
       WHERE status = 'pending' AND scheduled_at <= datetime('now')
       ORDER BY scheduled_at ASC
       LIMIT ?1`,
    ).bind(DISPATCH_LIMIT).all()
    due = result.results ?? []
  } catch (err) {
    logError('cg_lead.outbox_read_failed', err)
    return
  }

  if (due.length === 0) return
  logEvent('cg_lead.outbox_dispatch', { due: due.length })

  // Sequential, not parallel: these are a handful of rows a minute, and the
  // daily budget below is a read-modify-write that is simplest to reason about
  // one at a time.
  for (const row of due) {
    try {
      await dispatchOne(env, row)
    } catch (err) {
      logError('cg_lead.outbox_dispatch_failed', err)
      await finishRow(env, row.id, 'failed', 'exception')
    }
  }
}

async function dispatchOne(env, row) {
  // Claim the row so two overlapping cron runs cannot both send it. A second
  // run matches nothing here and moves on.
  const claimed = await env.DB.prepare(
    `UPDATE cg_lead_outbox SET status = 'sending'
     WHERE id = ?1 AND status = 'pending'
     RETURNING id`,
  ).bind(row.id).first()
  if (!claimed) return

  // Global daily ceiling. Checked before the weekly slot so that, on a day the
  // cap is reached, a number is not marked as having had its one message for
  // the week when nothing was actually sent.
  const withinBudget = await consumeDailyBudget(env)
  if (!withinBudget) {
    await finishRow(env, row.id, 'skipped', 'daily_cap')
    return
  }

  // THE weekly guarantee. Atomic: a number already messaged inside the window
  // matches the guard, no row comes back, and this send is dropped.
  const slot = await claimSendSlot(env, row.phone, row.template_name)
  if (!slot) {
    logEvent('cg_lead.whatsapp_cooldown_skip', { phone: row.phone, templateName: row.template_name, at: 'dispatch' })
    await finishRow(env, row.id, 'skipped', 'cooldown')
    return
  }

  const result = await sendConfirmation(env, row.phone, row.name, row.template_name)

  if (!result.ok) {
    logError('cg_lead.whatsapp_send_failed', `${result.errorCode}: ${result.errorMessage}`)
    // Give the slot back. The rule is one SUCCESSFUL message per number per
    // week — a failure must not lock the number out for 7 days over a message
    // it never received, which is exactly what happened in production on
    // 2026-10-01 when a template-parameter mismatch failed every send.
    await releaseSendSlot(env, row.phone, row.template_name)
    await recordMessage(env, { phone: row.phone, status: 'failed', errorCode: result.errorCode, errorMessage: result.errorMessage })
    await finishRow(env, row.id, 'failed', null)
    return
  }

  logEvent('cg_lead.whatsapp_sent', { phone: row.phone, templateName: row.template_name, messageId: result.messageId })
  await recordMessage(env, { phone: row.phone, status: 'sent', messageId: result.messageId })
  await finishRow(env, row.id, 'sent', null)
}

async function finishRow(env, id, status, reason) {
  try {
    await env.DB.prepare(
      'UPDATE cg_lead_outbox SET status = ?2, skip_reason = ?3 WHERE id = ?1',
    ).bind(id, status, reason).run()
  } catch (err) {
    logError('cg_lead.outbox_finish_failed', err)
  }
}

/* ── Weekly slot ────────────────────────────────────────────────────────── */

// Atomically claims the right to send to `phone` for `template`. Guarded
// UPSERT: a number still inside its window matches the WHERE, the statement
// modifies no row, and RETURNING hands back nothing — so a blocked number
// costs no D1 write at all, not merely a skipped send.
async function claimSendSlot(env, phone, template) {
  const row = await env.DB.prepare(
    `INSERT INTO template_send_cooldowns (phone, template_name, last_sent_at)
     VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(phone, template_name) DO UPDATE SET last_sent_at = datetime('now')
       WHERE template_send_cooldowns.last_sent_at <= datetime('now', ?3)
     RETURNING last_sent_at`,
  ).bind(phone, template, `-${COOLDOWN_DAYS} days`).first()
  return Boolean(row)
}

async function releaseSendSlot(env, phone, template) {
  try {
    await env.DB.prepare(
      'DELETE FROM template_send_cooldowns WHERE phone = ?1 AND template_name = ?2',
    ).bind(phone, template).run()
  } catch (err) {
    logError('cg_lead.whatsapp_cooldown_release_failed', err)
  }
}

/* ── Daily budget ───────────────────────────────────────────────────────── */

// Global ceiling on sends per UTC day. The form is public and unauthenticated,
// so Turnstile raises the cost of automating it but does not cap volume, and
// every send is a billed Meta conversation to a number nobody verified the
// submitter owns.
//
// Unlike consumeDailyBudget in routes/gstn/index.js (which fails OPEN — the
// cost of being wrong there is one lookup of already-public data), this fails
// CLOSED on a missing or invalid cap: what is being protected is money and the
// WABA's quality rating with Meta, and the confirmation is best-effort anyway.
// Only an explicit "0" disables the ceiling.
async function consumeDailyBudget(env) {
  const capRaw = env.WHATSAPP_CG_LEAD_DAILY_CAP
  if (capRaw === '0') return true

  const cap = Number(capRaw)
  if (!Number.isFinite(cap) || cap <= 0) {
    logEvent('cg_lead.whatsapp_budget_misconfigured', { cap: capRaw ?? null })
    return false
  }

  const day = new Date().toISOString().slice(0, 10)
  let row
  try {
    // Guarded so the statement writes nothing once the ceiling is reached —
    // which is what stops this counter from being able to burn through D1's
    // free-tier daily row-write budget (see migration 0006).
    row = await env.DB.prepare(
      `INSERT INTO cg_lead_whatsapp_budget (day, sent) VALUES (?1, 1)
         ON CONFLICT(day) DO UPDATE SET sent = sent + 1
           WHERE cg_lead_whatsapp_budget.sent < ?2
       RETURNING sent`,
    ).bind(day, cap).first()
  } catch (err) {
    logError('cg_lead.whatsapp_budget_check_failed', err)
    return false
  }

  if (!row) {
    logEvent('cg_lead.whatsapp_daily_cap_reached', { day, cap })
    return false
  }
  if (row.sent === Math.floor(cap * 0.8)) {
    logEvent('cg_lead.whatsapp_budget_80pct', { day, cap, sent: row.sent })
  }
  return true
}

/* ── Meta send ──────────────────────────────────────────────────────────── */

// Approved-template definitions, cached per isolate. The send needs the
// template's REAL shape, because Meta rejects a mismatched parameter count
// outright: production failed every confirmation with `132000 Number of
// parameters does not match the expected number of params` while this code
// hardcoded a single body parameter. Any hardcoded count is the same bug
// waiting for someone to edit the template, so the count is derived instead.
// A failed fetch is not cached, so a Meta blip cannot pin a null for 10 min.
let templateCache = { at: 0, list: null }
const TEMPLATE_CACHE_MS = 10 * 60 * 1000

async function getApprovedTemplate(env, name, language) {
  if (!templateCache.list || Date.now() - templateCache.at > TEMPLATE_CACHE_MS) {
    templateCache = { at: Date.now(), list: await fetchApprovedTemplates(env) }
  }
  const list = templateCache.list ?? []
  // Exact language first, then the same name in any language: a template
  // approved as `en_US` does not match a configured plain `en`, and that
  // mismatch is its own silent send failure.
  return list.find((t) => t.name === name && t.language === language)
    ?? list.find((t) => t.name === name)
    ?? null
}

async function sendConfirmation(env, phone, name, template) {
  const configuredLanguage = templateLanguage(env)

  let definition = null
  try {
    definition = await getApprovedTemplate(env, template, configuredLanguage)
  } catch (err) {
    logError('cg_lead.template_lookup_failed', err)
  }

  let components
  let language = configuredLanguage

  if (definition) {
    language = definition.language || configuredLanguage
    const tokens = templateTokens(definition)
    // `buttons` is logged because buildComponents does NOT emit a button
    // component: a template carrying a dynamic URL or copy-code button needs a
    // button parameter of its own, and omitting it fails with the SAME 132000
    // as a wrong body-parameter count. Without this the two are
    // indistinguishable in the logs.
    logEvent('cg_lead.template_shape', {
      templateName: template,
      language,
      tokens,
      buttons: (definition.buttons ?? []).map((b) => b?.type ?? 'unknown'),
    })

    if (tokens.length > 0) {
      // The lead's name fills the FIRST declared variable ({{1}} in the
      // intended template). Any further variables take buildComponents' ' '
      // fallback — their meaning is unknown to us, but the parameter COUNT is
      // what Meta rejects, and a blank beats no confirmation at all.
      const map = { [tokens[0]]: { source: 'literal', value: name } }
      components = buildComponents(definition, map, {}, { fallback: ' ' })
    }
    // No tokens leaves `components` undefined — a static send, which is
    // exactly what a template with no variables requires.
  } else {
    logEvent('cg_lead.template_unresolved', { templateName: template, language })
    components = [{ type: 'body', parameters: [{ type: 'text', text: name }] }]
  }

  try {
    return await sendTemplateMessage(env, { to: phone, templateName: template, languageCode: language, components })
  } catch (err) {
    logError('cg_lead.whatsapp_send_exception', err)
    return { ok: false, errorCode: 'exception', errorMessage: err?.message || 'Send failed' }
  }
}

/* ── Status bookkeeping ─────────────────────────────────────────────────── */

// Records the outcome as a plain row in the same `messages` table campaigns
// use — deliberately WITHOUT campaign_id, contact_id or conversation_id, all
// left NULL. That combination is what GET /api/cg-leads/whatsapp-status
// filters on to find exactly these rows (campaign sends always set
// campaign_id; inbox replies always set conversation_id). Reusing this table
// means the EXISTING delivery-webhook pipeline tracks sent -> delivered ->
// read for these automatically, since it matches purely on meta_message_id.
async function recordMessage(env, { phone, status, messageId = null, errorCode = null, errorMessage = null }) {
  const column = status === 'failed' ? 'failed_at' : 'sent_at'
  try {
    await env.DB.prepare(
      `INSERT INTO messages (phone, meta_message_id, status, error_code, error_message, ${column})
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))`,
    ).bind(phone, messageId, status, errorCode, errorMessage).run()
  } catch (err) {
    // The Meta send already happened; this only means the dashboard's status
    // column will under-report. Not worth failing anything over.
    logError('cg_lead.whatsapp_record_failed', err)
  }
}
