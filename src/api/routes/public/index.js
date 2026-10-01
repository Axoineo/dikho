import { Hono } from 'hono'
import { parseJson } from '../../middleware/errorHandler.js'
import { ok } from '../../utils/response.js'
import { verifyTurnstile } from '../../services/turnstile.js'
import { callRpc } from '../../services/supabaseRpc.js'
import { fetchApprovedTemplates, sendTemplateMessage } from '../../services/whatsapp/graph.js'
import { buildComponents, sanitizeParam, templateTokens } from '../../../lib/templateVars.js'
import { logEvent, logError } from '../../utils/logger.js'

// Unauthenticated write endpoints for the two public forms. These are the only
// routes under /api that accept a write from someone with no session, so each
// one is gated on a Turnstile token before it reaches Supabase.
//
// Flow per submit:
//   browser renders the widget with `action` ──► token
//   POST here with { "cf-turnstile-response": token, ...payload }
//   verifyTurnstile() ──► siteverify (success + action + hostname)
//   callRpc() with the service-role key ──► SECURITY DEFINER RPC
//
// Deliberately NOT registered behind requireAuth in app.js — the whole point is
// that the public has no session. Turnstile is what stands in for one.
const publicRoutes = new Hono()

// Bound to the `data-action` / `action:` value each form renders its widget
// with. Keep these in sync with src/features/public/* — a mismatch makes every
// submit fail the action check (and shows up as turnstile.rejected in the logs).
const ACTION_VENDOR_REGISTER = 'vendor-register'
const ACTION_CG_LEAD = 'cg-lead'

// The field name Cloudflare's own docs use for the token, kept verbatim so this
// matches what a plain (non-JS) Turnstile form post would send.
const TOKEN_FIELD = 'cf-turnstile-response'

// WhatsApp confirmation sent after a corporate-gifting lead is captured (see
// notifyCgLead below). Overridable via wrangler.api.jsonc so a wrong/renamed
// Meta template name is a var change, not a code redeploy.
const CG_LEAD_TEMPLATE_NAME = 'client_conformation_'
const CG_LEAD_TEMPLATE_LANG = 'en'

// At most one send per phone number per template within this many days, no
// matter how many times that number resubmits the form — see
// claimTemplateSend and migrations/0008_template_send_cooldown.sql.
const CG_LEAD_COOLDOWN_DAYS = 7

/**
 * Public vendor registration — src/features/public/PublicVendorForm.jsx.
 * The document upload still goes to Supabase storage straight from the browser;
 * only the vendor + address rows come through here.
 */
publicRoutes.post('/vendor', async (c) => {
  const body = await parseJson(c)
  await verifyTurnstile(c, body?.[TOKEN_FIELD], ACTION_VENDOR_REGISTER)

  // The RPC whitelists and coerces every column itself, and assigns `status`
  // and `opening_balance` server-side, so the payload is passed through as-is
  // rather than re-validated here.
  const id = await callRpc(c, 'public_register_vendor', {
    p_vendor: body?.vendor ?? {},
    p_address: body?.address ?? {},
  })

  return ok(c, { id })
})

// Global daily ceiling on WhatsApp sends from this route — see
// migrations/0009_cg_lead_whatsapp_daily_budget.sql for why: the route is
// public and unauthenticated, so Turnstile raises the cost of automating it
// but does not cap volume, and each send is a billed Meta conversation to a
// number the form never verified the visitor owns. Unlike consumeDailyBudget
// in routes/gstn/index.js (which fails OPEN on a missing cap — the cost of
// being wrong there is one lookup of already-public data), this FAILS CLOSED
// on a missing/invalid cap: the thing being protected is money and the WABA's
// own quality rating with Meta, and this send is already best-effort, so
// skipping it costs nothing but a delayed confirmation. Only an explicit cap
// of "0" disables the ceiling on purpose.
async function consumeCgLeadWhatsappBudget(env) {
  const capRaw = env.WHATSAPP_CG_LEAD_DAILY_CAP
  if (capRaw === '0') return true

  const cap = Number(capRaw)
  if (!Number.isFinite(cap) || cap <= 0) {
    logEvent('cg_lead.whatsapp_budget_misconfigured', { cap: capRaw ?? null })
    return false
  }

  const day = new Date().toISOString().slice(0, 10)
  // One statement, one write, and no write at all once the ceiling is
  // reached — same shape as consumeDailyBudget, see that function for why
  // this is what keeps an uncapped attacker from being able to burn D1's
  // free-tier write budget the way migration 0006 records happening once already.
  const row = await env.DB.prepare(
    `INSERT INTO cg_lead_whatsapp_budget (day, sent) VALUES (?1, 1)
       ON CONFLICT(day) DO UPDATE SET sent = sent + 1
         WHERE cg_lead_whatsapp_budget.sent < ?2
     RETURNING sent`,
  ).bind(day, cap).first()

  if (!row) {
    // Deliberately loud: on a public unauthenticated route this is either
    // real traffic outgrowing the guess above, or abuse — either way it needs
    // a human to look, and nothing else reports it.
    logEvent('cg_lead.whatsapp_daily_cap_reached', { day, cap })
    return false
  }
  if (row.sent === Math.floor(cap * 0.8)) {
    logEvent('cg_lead.whatsapp_budget_80pct', { day, cap, sent: row.sent })
  }
  return true
}

// Atomically claims the right to notify `phone` for `templateName` — the same
// guarded-UPSERT shape as consumeDailyBudget in routes/gstn/index.js. Only a
// send that wins the claim costs a D1 write; a number still inside its
// cooldown matches the WHERE guard, the statement is a no-op, and RETURNING
// hands back no row — so repeat form submissions from the same number are
// free, not just skipped.
async function claimTemplateSend(db, phone, templateName, cooldownDays) {
  const row = await db.prepare(
    `INSERT INTO template_send_cooldowns (phone, template_name, last_sent_at)
     VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(phone, template_name) DO UPDATE SET last_sent_at = datetime('now')
       WHERE template_send_cooldowns.last_sent_at <= datetime('now', ?3)
     RETURNING last_sent_at`,
  ).bind(phone, templateName, `-${cooldownDays} days`).first()
  return Boolean(row)
}

// Approved-template definitions, cached per isolate. The send path needs the
// template's REAL shape (how many {{...}} it declares, and in which
// component) because Meta rejects a mismatched parameter count outright —
// production failed every cg-lead send with
// `132000 Number of parameters does not match the expected number of params`
// while hardcoding a single body parameter. Hardcoding any fixed count is the
// same bug waiting to happen again the moment the template is edited on Meta's
// side, so the count is derived instead.
//
// Cached because this costs a Workers subrequest and the definition changes
// about never (editing an approved template requires re-approval from Meta).
// A failed fetch is NOT cached, so a Meta blip doesn't pin a null for 10
// minutes.
let templateCache = { at: 0, list: null }
const TEMPLATE_CACHE_MS = 10 * 60 * 1000

async function getApprovedTemplate(env, name, language) {
  if (!templateCache.list || Date.now() - templateCache.at > TEMPLATE_CACHE_MS) {
    templateCache = { at: Date.now(), list: await fetchApprovedTemplates(env) }
  }
  const list = templateCache.list ?? []
  // Exact language first; then same name in any language, since a template
  // approved as e.g. `en_US` will not match a configured plain `en` and that
  // mismatch is its own silent send failure.
  return list.find((t) => t.name === name && t.language === language)
    ?? list.find((t) => t.name === name)
    ?? null
}

// Records the outcome of a cg-lead send as a plain row in the same `messages`
// table campaigns use — deliberately WITHOUT campaign_id, contact_id or
// conversation_id, all left NULL. That is what the dashboard's
// GET /api/cg-leads/whatsapp-status (routes/cgLeads/index.js) filters on to
// find exactly these rows and nothing else (campaign sends always set
// campaign_id; inbox/agent replies always set conversation_id). The payoff of
// reusing this table rather than inventing a parallel one: the EXISTING
// delivery-webhook pipeline (routes/whatsapp/webhook.js) matches purely on
// meta_message_id, so sent -> delivered -> read updates for these rows work
// automatically with zero changes to that pipeline.
async function recordCgLeadMessage(db, { phone, status, messageId = null, errorCode = null, errorMessage = null }) {
  const column = status === 'failed' ? 'failed_at' : 'sent_at'
  await db.prepare(
    `INSERT INTO messages (phone, meta_message_id, status, error_code, error_message, ${column})
     VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))`,
  ).bind(phone, messageId, status, errorCode, errorMessage).run()
}

// Best-effort WhatsApp confirmation for a new lead, run via waitUntil so a
// slow or failing Meta call never delays or fails the form's own response —
// the lead is already saved in Supabase by the time this runs. The claim is
// made BEFORE the Meta call (not after), so two near-simultaneous submits for
// the same number can only ever result in one send, matching how
// claimRecipients in routes/campaigns/index.js guards against the same race.
// {{1}} in the template body is filled from the "Your Name" field.
async function notifyCgLead(env, lead) {
  const phone = `${lead?.country_code ?? ''}${lead?.mobile ?? ''}`.replace(/\D/g, '')
  const name = sanitizeParam(lead?.name)
  if (!phone || !name) return

  if (!env.DB) {
    logEvent('cg_lead.whatsapp_skipped', { reason: 'no_db_binding' })
    return
  }

  const templateName = env.WHATSAPP_CG_LEAD_TEMPLATE_NAME || CG_LEAD_TEMPLATE_NAME
  const languageCode = env.WHATSAPP_CG_LEAD_TEMPLATE_LANG || CG_LEAD_TEMPLATE_LANG

  // Budget gated BEFORE the per-phone cooldown claim below, and never the
  // other way around: claiming a phone's cooldown slot before confirming
  // there is budget to actually send would silently cost a genuine new lead
  // their one WhatsApp confirmation for a full week — on exactly the days
  // traffic is high enough for the cap to matter.
  let withinBudget
  try {
    withinBudget = await consumeCgLeadWhatsappBudget(env)
  } catch (err) {
    logError('cg_lead.whatsapp_budget_check_failed', err)
    return
  }
  if (!withinBudget) return

  let claimed
  try {
    claimed = await claimTemplateSend(env.DB, phone, templateName, CG_LEAD_COOLDOWN_DAYS)
  } catch (err) {
    logError('cg_lead.whatsapp_claim_failed', err)
    return
  }
  if (!claimed) {
    logEvent('cg_lead.whatsapp_cooldown_skip', { phone, templateName })
    return
  }

  // Resolve the template's real shape before sending. Best-effort: if Meta is
  // unreachable we fall back to the previous assumption (one body parameter)
  // rather than skipping a confirmation entirely.
  let template = null
  try {
    template = await getApprovedTemplate(env, templateName, languageCode)
  } catch (err) {
    logError('cg_lead.template_lookup_failed', err)
  }

  let components
  let sendLanguage = languageCode
  if (template) {
    sendLanguage = template.language || languageCode
    const tokens = templateTokens(template)
    // Logged once per isolate-cache-miss rather than per send, and it is the
    // only record of what this template actually declares — worth having the
    // first time a send fails after someone edits it on Meta.
    // `buttons` is logged because buildComponents does NOT emit a button
    // component: a template carrying a dynamic URL/copy-code button needs a
    // button parameter of its own, and omitting it fails with the SAME 132000
    // as a wrong body-parameter count. Without this line that case is
    // indistinguishable from the one just fixed.
    logEvent('cg_lead.template_shape', {
      templateName,
      language: sendLanguage,
      tokens,
      buttons: (template.buttons ?? []).map((b) => b?.type ?? 'unknown'),
    })

    if (tokens.length > 0) {
      // The lead's name fills the FIRST declared variable ({{1}} in the
      // intended template). Any further variables the template turns out to
      // declare are filled with the ' ' fallback by buildComponents: we have
      // no idea what they mean, but the parameter COUNT is what Meta is
      // rejecting, and a blank is far better than no confirmation at all.
      const map = { [tokens[0]]: { source: 'literal', value: name } }
      components = buildComponents(template, map, {}, { fallback: ' ' })
    }
    // tokens.length === 0 leaves `components` undefined — a static send, which
    // is exactly what a template with no variables requires.
  } else {
    logEvent('cg_lead.template_unresolved', { templateName, languageCode })
    components = [{ type: 'body', parameters: [{ type: 'text', text: name }] }]
  }

  let result
  try {
    result = await sendTemplateMessage(env, {
      to: phone,
      templateName,
      languageCode: sendLanguage,
      components,
    })
  } catch (err) {
    logError('cg_lead.whatsapp_send_exception', err)
    return
  }

  if (!result.ok) {
    logError('cg_lead.whatsapp_send_failed', `${result.errorCode}: ${result.errorMessage}`)
    try {
      // Release the cooldown claim. The claim is taken BEFORE the send (so two
      // simultaneous submits can only produce one message), which means a
      // failure would otherwise lock this number out for the full 7 days over
      // a message it never received — exactly what happened in production on
      // 2026-10-01, where a template-parameter mismatch failed every send and
      // each failure then blocked its own retry.
      await env.DB.prepare(
        'DELETE FROM template_send_cooldowns WHERE phone = ?1 AND template_name = ?2',
      ).bind(phone, templateName).run()
    } catch (err) {
      logError('cg_lead.whatsapp_cooldown_release_failed', err)
    }
    try {
      await recordCgLeadMessage(env.DB, { phone, status: 'failed', errorCode: result.errorCode, errorMessage: result.errorMessage })
    } catch (err) {
      logError('cg_lead.whatsapp_record_failed', err)
    }
    return
  }

  logEvent('cg_lead.whatsapp_sent', { phone, templateName, messageId: result.messageId })
  try {
    await recordCgLeadMessage(env.DB, { phone, status: 'sent', messageId: result.messageId })
  } catch (err) {
    // The Meta send already succeeded — this only means the dashboard's
    // status column will show "Not sent" for a lead that in fact received
    // it. Logged so it's diagnosable, but not worth failing anything over.
    logError('cg_lead.whatsapp_record_failed', err)
  }
}

/**
 * Corporate-gifting lead — src/features/public/PublicClientWelcome.jsx.
 */
publicRoutes.post('/cg-lead', async (c) => {
  const body = await parseJson(c)
  await verifyTurnstile(c, body?.[TOKEN_FIELD], ACTION_CG_LEAD)

  const lead = body?.lead ?? {}
  await callRpc(c, 'public_submit_cg_lead', { p_lead: lead })

  // Fire-and-forget: the visitor's success screen does not wait on Meta, and a
  // WhatsApp failure must never turn an already-saved lead into a visible error.
  c.executionCtx.waitUntil(notifyCgLead(c.env, lead))

  return ok(c, { submitted: true })
})

export default publicRoutes
