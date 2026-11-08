import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { fetchApprovedTemplates, sendTemplateMessage } from '../../services/whatsapp/graph.js'
import { uploadMediaToMeta } from '../../services/whatsapp/media.js'
import { WATCHED_CODES, haltFor, mostlyFailed } from '../../services/whatsapp/sendHalts.js'
import {
  HEADER_MEDIA_KEY, buildComponents, mediaHeaderFormat, parseHeaderMedia,
} from '../../../lib/templateVars.js'
import { MAX_DASHBOARD_JSON_BYTES, formFile, readBoundedFormData, readJsonOr } from '../../utils/body.js'
import { safeDisplayName, sniffType } from '../../utils/fileType.js'
import { logEvent } from '../../utils/logger.js'
import { requirePermission } from '../../middleware/requireAuth.js'

const campaigns = new Hono()

// Each Meta send is one Workers subrequest. D1 calls don't count against this
// (they draw from a separate, much larger internal-services quota) — only the
// fetch() calls to graph.facebook.com do. Cloudflare's Workers FREE plan caps
// that at 50 per invocation (Paid raises it to 10,000+, configurable up to
// 10M), so a single request only handles a small slice; the frontend calls
// /send-batch repeatedly under the same campaignId to work through a larger
// audience. Read from env (wrangler.api.jsonc `vars`) so moving to the Paid
// plan is a config change + redeploy, not a code change — see that file for
// the values to bump.
const DEFAULT_BATCH_LIMIT = 40
const DEFAULT_CONCURRENCY = 5
const MAX_RECIPIENTS = 2000

function batchLimit(env) {
  return Number(env.CAMPAIGN_BATCH_LIMIT) || DEFAULT_BATCH_LIMIT
}

// Workers also cap simultaneous in-flight connections at 6 regardless of
// plan, so this should stay ≤6 even after a plan upgrade raises BATCH_LIMIT.
function concurrency(env) {
  return Number(env.CAMPAIGN_CONCURRENCY) || DEFAULT_CONCURRENCY
}

// What one campaign's sends are built from. A photo, video or document header
// needs its file on every send, or Meta refuses each message with 132012, so a
// missing or malformed file is refused here, before anything is stored or sent.
// The file is kept in the variable map (HEADER_MEDIA_KEY) only in its validated
// form, which is what a retry reads back. `missingMediaMessage` is the refusal.
function prepareSend(template, variableMap, missingMediaMessage) {
  const map = variableMap && typeof variableMap === 'object' && !Array.isArray(variableMap) ? { ...variableMap } : {}
  delete map[HEADER_MEDIA_KEY]

  const format = mediaHeaderFormat(template)
  if (format) {
    const media = parseHeaderMedia(variableMap?.[HEADER_MEDIA_KEY]?.value)
    if (!media) throw new HTTPException(400, { message: missingMediaMessage(format.toLowerCase()) })
    map[HEADER_MEDIA_KEY] = { source: 'media', value: media.id ?? media.link }
  }

  const hasVariables = /\{\{/.test(template.headerText ?? '') || /\{\{/.test(template.bodyText ?? '')
  return { variableMap: map, withComponents: hasVariables || Boolean(format) }
}

const addMediaMessage = (kind) => `This template has a ${kind} header. Add a public https link to the ${kind}, or its WhatsApp media ID.`

// The header format comes from the wizard, as the header and body text already
// do. Anything but a known media format is treated as a text header.
function requestTemplate({ templateHeader = '', templateHeaderFormat = '', templateBody = '' }) {
  return {
    headerText: typeof templateHeader === 'string' ? templateHeader : '',
    headerFormat: typeof templateHeaderFormat === 'string' ? templateHeaderFormat.slice(0, 20) : '',
    bodyText: typeof templateBody === 'string' ? templateBody : '',
  }
}

function parseAttributes(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

// Runs `worker` over `items` with a fixed number of parallel lanes, preserving
// result order. Keeps the Meta API from being hit with 500 simultaneous calls.
// Once `shouldStop()` is true no new item starts; skipped items stay undefined.
async function mapWithConcurrency(items, limit, worker, shouldStop = () => false) {
  const results = new Array(items.length)
  let cursor = 0

  async function lane() {
    while (cursor < items.length && !shouldStop()) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}

// Loads contacts by chunked IDs. D1 caps bound parameters at 100 per query
// (not SQLite's usual 999), so chunks must stay at or under that.
async function loadRecipients(db, ids) {
  const recipients = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await db
      .prepare(
        `SELECT id, name, phone, email, company, attributes
         FROM contacts WHERE id IN (${placeholders}) AND opted_out = 0`,
      )
      .bind(...chunk)
      .all()
    recipients.push(...results)
  }
  return recipients
}

// Atomically claims a fresh row for each recipient before any Meta call is
// made. Backed by the unique (campaign_id, contact_id) index (migration
// 0005): ON CONFLICT DO NOTHING means a request that gets replayed against
// the same campaign — e.g. the frontend's retry-with-backoff firing again
// after a dropped connection, or a double click — only ever proceeds with
// whichever recipients it is the *first* to successfully claim. Anyone
// already claimed by an earlier attempt is silently skipped here rather than
// messaged a second time. Returns the subset of `recipients` that won.
async function claimRecipients(db, campaignId, recipients) {
  if (recipients.length === 0) return []
  const insertClaim = db.prepare(
    `INSERT INTO messages (campaign_id, contact_id, phone, status)
     VALUES (?, ?, ?, 'pending')
     ON CONFLICT(campaign_id, contact_id) DO NOTHING
     RETURNING contact_id`,
  )
  const claimed = new Set()
  // D1 limits batch() to ~100 statements.
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100)
    const results = await db.batch(chunk.map((r) => insertClaim.bind(campaignId, r.id, r.phone)))
    for (const result of results) {
      for (const row of result.results) claimed.add(row.contact_id)
    }
  }
  return recipients.filter((r) => claimed.has(r.id))
}

// Same idea for a retry: claims by atomically flipping an existing `failed`
// row to `pending` instead of inserting a new one. A concurrent/duplicate
// retry racing on the same contact matches nothing (the row is no longer
// `failed`) and gets 0 rows back, so it skips that contact entirely.
async function claimFailedRecipients(db, campaignId, recipients) {
  if (recipients.length === 0) return []
  const claimUpdate = db.prepare(
    `UPDATE messages SET status = 'pending', error_code = NULL, error_message = NULL, failed_at = NULL
     WHERE campaign_id = ? AND contact_id = ? AND status = 'failed'
     RETURNING contact_id`,
  )
  const claimed = new Set()
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100)
    const results = await db.batch(chunk.map((r) => claimUpdate.bind(campaignId, r.id)))
    for (const result of results) {
      for (const row of result.results) claimed.add(row.contact_id)
    }
  }
  return recipients.filter((r) => claimed.has(r.id))
}

// Sends to a list of already-claimed recipients. Returns the per-recipient
// outcomes, and, when Meta answered with an error that should stop the whole
// campaign (sendHalts.js), that halt plus the recipients never attempted.
// Persistence (finishBatch) is a separate step so callers that claimed via
// INSERT vs UPDATE can share this.
async function sendToRecipients(env, { recipients, templateName, templateLanguage, template, withComponents, variableMap }) {
  let halt = null
  const results = await mapWithConcurrency(recipients, concurrency(env), async (recipient) => {
    const contact = { ...recipient, attributes: parseAttributes(recipient.attributes) }
    const components = withComponents ? buildComponents(template, variableMap, contact) : undefined

    let result
    try {
      result = await sendTemplateMessage(env, {
        to: recipient.phone,
        templateName: templateName.trim(),
        languageCode: templateLanguage,
        components,
      })
    } catch (err) {
      result = { ok: false, errorCode: 'exception', errorMessage: err.message || 'Send failed' }
    }
    if (!result.ok && !halt) halt = haltFor(result.errorCode)
    return { recipient, result }
  }, () => Boolean(halt))

  const outcomes = results.filter(Boolean)
  const attempted = new Set(outcomes.map(({ recipient }) => recipient.id))
  const skipped = recipients.filter((recipient) => !attempted.has(recipient.id))
  return { outcomes, skipped, halt: halt ?? mostlyFailed(outcomes) }
}

const NOTHING_SENT = { outcomes: [], skipped: [], halt: null }

// A stopped batch's unattempted recipients go back to "never attempted": their
// claim is removed, so they show in the campaign's unsent list for later.
async function releaseClaims(db, campaignId, recipients) {
  const release = db.prepare(
    `DELETE FROM messages
     WHERE campaign_id = ? AND contact_id = ? AND status = 'pending' AND meta_message_id IS NULL`,
  )
  for (let i = 0; i < recipients.length; i += 100) {
    await db.batch(recipients.slice(i, i + 100).map((r) => release.bind(campaignId, r.id)))
  }
}

// A stop-the-campaign error Meta reported by webhook in the last 24 hours, for
// example 131048 (spam limit) arriving after the previous batch was accepted.
async function recordedHalt(db, campaignId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const row = await db.prepare(
    `SELECT error_code FROM messages
     WHERE campaign_id = ?1 AND status = 'failed' AND failed_at > ?2
       AND error_code IN (${WATCHED_CODES.map((_, i) => `?${i + 3}`).join(',')})
     LIMIT 1`,
  ).bind(campaignId, since, ...WATCHED_CODES).first()
  return row ? haltFor(row.error_code) : null
}

// Saves a batch and says what comes next. A halted batch marks the campaign
// `stopped` and answers with `notSent` instead of `remaining`: every client
// loops while `remaining` is non-empty, so leaving it out is what stops them,
// including a dashboard tab still running older code.
async function finishBatch(db, campaignId, run, remainingIds) {
  await finalizeMessages(db, campaignId, run.outcomes)
  const { sent, failed, firstError } = summarizeOutcomes(run.outcomes)
  if (!run.halt) {
    await updateCampaignProgress(db, campaignId, { final: remainingIds.length === 0 })
    return { sent, failed, firstError, ...(remainingIds.length > 0 ? { remaining: remainingIds } : {}) }
  }
  await releaseClaims(db, campaignId, run.skipped)
  await updateCampaignProgress(db, campaignId, { final: false })
  await db.prepare(`UPDATE campaigns SET status = 'stopped' WHERE id = ?`).bind(campaignId).run()
  logEvent('campaigns.send.halted', { campaignId, code: run.halt.code })
  return {
    sent, failed, firstError,
    notSent: [...run.skipped.map((r) => r.id), ...remainingIds],
    halted: { code: run.halt.code, reason: run.halt.reason, resumable: run.halt.resumable },
  }
}

async function haltedBeforeSending(db, campaignId, halt, ids) {
  await db.prepare(`UPDATE campaigns SET status = 'stopped' WHERE id = ?`).bind(campaignId).run()
  return {
    campaignId, total: 0, sent: 0, failed: 0, firstError: null, notSent: ids,
    halted: { code: halt.code, reason: halt.reason, resumable: halt.resumable },
  }
}

// Writes the final outcome onto each claimed (`pending`) row.
async function finalizeMessages(db, campaignId, outcomes) {
  if (outcomes.length === 0) return
  const updateMessage = db.prepare(
    `UPDATE messages
     SET meta_message_id = ?, status = ?, error_code = ?, error_message = ?, sent_at = ?, failed_at = ?
     WHERE campaign_id = ? AND contact_id = ?`,
  )
  const now = new Date().toISOString()

  const bindings = outcomes.map(({ recipient, result }) => updateMessage.bind(
    result.ok ? result.messageId : null,
    result.ok ? 'sent' : 'failed',
    result.ok ? null : result.errorCode,
    result.ok ? null : result.errorMessage,
    result.ok ? now : null,
    result.ok ? null : now,
    campaignId,
    recipient.id,
  ))

  // D1 limits batch() to ~100 statements.
  for (let i = 0; i < bindings.length; i += 100) {
    await db.batch(bindings.slice(i, i + 100))
  }
}

function summarizeOutcomes(outcomes) {
  const sent = outcomes.filter(({ result }) => result.ok).length
  const failed = outcomes.length - sent
  const firstError = outcomes.find(({ result }) => !result.ok)?.result.errorMessage ?? null
  return { sent, failed, firstError }
}

// Recomputes sent/failed from the messages table (the source of truth) and
// writes them onto the campaign row after every batch, not just the last
// one — so a campaign interrupted mid-send doesn't stay stuck at 0/0.
// On the final batch it also flips status to completed/failed.
async function updateCampaignProgress(db, campaignId, { final }) {
  const totals = await db.prepare(
    `SELECT SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM messages WHERE campaign_id = ?`,
  ).bind(campaignId).first()

  const sent = totals?.sent ?? 0
  const failed = totals?.failed ?? 0

  if (!final) {
    await db.prepare(
      `UPDATE campaigns SET sent_count = ?, failed_count = ? WHERE id = ?`,
    ).bind(sent, failed, campaignId).run()
    return { sent, failed }
  }

  const now = new Date().toISOString()
  await db.prepare(
    `UPDATE campaigns
     SET sent_count = ?, failed_count = ?, status = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(sent, failed, sent > 0 ? 'completed' : 'failed', now, campaignId).run()
  return { sent, failed }
}

// Distinct contacts that currently have a failed message on this campaign —
// the retryable set. Re-derived from `messages` (the source of truth) rather
// than trusting campaigns.failed_count, which is just a cached rollup.
async function loadFailedContactIds(db, campaignId) {
  const { results } = await db.prepare(
    `SELECT DISTINCT contact_id FROM messages
     WHERE campaign_id = ? AND status = 'failed' AND contact_id IS NOT NULL`,
  ).bind(campaignId).all()
  return results.map((row) => row.contact_id)
}

// Everyone on this campaign who has no successful message, split by why.
//
// Two different holes have to be filled, and only one of them used to be
// visible. A `failed` row means Meta rejected the send and said why. A
// *missing* row means the send never got that far at all — the batch loop
// died, the tab closed, or D1 stopped accepting writes mid-campaign — and
// leaves nothing behind to find. Reconciling against the recorded audience is
// what surfaces the second kind.
//
// `audience` is NULL for campaigns created before migration 0006. Those can
// still report their failed rows exactly; the never-attempted set is only
// computable by assuming the audience was every eligible contact, which is
// right for a send-to-everyone campaign and wrong for a targeted one. So it
// stays behind `includeUnrecorded` and is reported as inferred, never guessed
// at silently.
async function loadUnsentRecipients(db, campaign, { includeUnrecorded = false } = {}) {
  const audienceIds = campaign.audience ? JSON.parse(campaign.audience) : null
  const audienceSource = audienceIds ? 'stored' : 'inferred'

  const { results: failed } = await db.prepare(
    `SELECT m.contact_id AS id, c.name, c.phone, m.error_code, m.error_message, m.failed_at
     FROM messages m
     JOIN contacts c ON c.id = m.contact_id
     WHERE m.campaign_id = ? AND m.status = 'failed' AND m.contact_id IS NOT NULL
     ORDER BY c.name`,
  ).bind(campaign.id).all()

  const contacts = failed.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    reason: 'failed',
    errorCode: row.error_code,
    errorMessage: row.error_message,
    at: row.failed_at,
  }))

  // Never-attempted: in the audience, but with no message row on this campaign.
  if (audienceIds || includeUnrecorded) {
    let missing = []
    if (audienceIds) {
      // Chunked at 100 — D1 caps bound parameters per query at 100, not
      // SQLite's usual 999.
      for (let i = 0; i < audienceIds.length; i += 100) {
        const chunk = audienceIds.slice(i, i + 100)
        const placeholders = chunk.map(() => '?').join(',')
        const { results } = await db.prepare(
          `SELECT c.id, c.name, c.phone FROM contacts c
           WHERE c.id IN (${placeholders}) AND c.opted_out = 0
             AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = ? AND m.contact_id = c.id)`,
        ).bind(...chunk, campaign.id).all()
        missing.push(...results)
      }
    } else {
      const { results } = await db.prepare(
        `SELECT c.id, c.name, c.phone FROM contacts c
         WHERE c.opted_out = 0
           AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = ? AND m.contact_id = c.id)
         ORDER BY c.name`,
      ).bind(campaign.id).all()
      missing = results
    }

    for (const row of missing) {
      contacts.push({
        id: row.id,
        name: row.name,
        phone: row.phone,
        reason: 'never_attempted',
        errorCode: null,
        errorMessage: null,
        at: null,
      })
    }
  }

  return {
    audienceSource,
    contacts,
    counts: {
      total: contacts.length,
      failed: contacts.filter((x) => x.reason === 'failed').length,
      neverAttempted: contacts.filter((x) => x.reason === 'never_attempted').length,
    },
  }
}

// The campaigns row only keeps template_name/template_language (+ the
// variable map that was used) — not the raw header/body text, which lives on
// Meta's side and can change or be revoked between the original send and a
// retry. Re-fetch it so buildComponents works off the current template.
async function resolveCampaignTemplate(env, name, language) {
  let list
  try {
    list = await fetchApprovedTemplates(env)
  } catch (err) {
    throw new HTTPException(502, { message: `Could not reach Meta to verify the template: ${err.message}` })
  }
  const template = list.find((t) => t.name === name && t.language === language)
  if (!template) {
    throw new HTTPException(400, {
      message: `Template "${name}" (${language}) is no longer approved on Meta — cannot retry`,
    })
  }
  return template
}

/* ── GET /api/campaigns ────────────────────────────────────────────────── */

campaigns.get('/', requirePermission('campaigns.view', 'campaigns.send'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, template_name, template_language, status,
            total_count, sent_count, failed_count, created_at, completed_at
     FROM campaigns
     ORDER BY created_at DESC
     LIMIT 100`,
  ).all()

  return ok(c, { campaigns: results })
})

/* ── GET /api/campaigns/stats ──────────────────────────────────────────── */

campaigns.get('/stats', requirePermission('campaigns.view', 'campaigns.send'), async (c) => {
  const [contactCount, campaignCount, messageStats] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) AS total FROM contacts WHERE opted_out = 0'),
    c.env.DB.prepare('SELECT COUNT(*) AS total FROM campaigns'),
    // Campaign sends only. `messages` also carries the inbox — inbound customer
    // messages and the free-form replies agents type — and counting those here
    // inflated every campaign number on the overview (12 agent replies were
    // being reported as marketing sends).
    //
    // `accepted` is everything Meta's API took from us. `awaiting` is the
    // subset still holding a `sent` with no terminal receipt: Meta accepted it
    // and has told us nothing since. Meta's own reporting does not count those
    // as sent, which is most of why the two dashboards disagree.
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status IN ('sent','delivered','read','failed') THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS awaiting,
         SUM(CASE WHEN status IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) AS read_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM messages
       WHERE campaign_id IS NOT NULL AND direction = 'outbound'`,
    ),
  ])

  const stats = messageStats.results[0] ?? {}
  return ok(c, {
    contacts: contactCount.results[0]?.total ?? 0,
    campaigns: campaignCount.results[0]?.total ?? 0,
    messages: stats.total ?? 0,
    accepted: stats.accepted ?? 0,
    awaiting: stats.awaiting ?? 0,
    delivered: stats.delivered ?? 0,
    read: stats.read_count ?? 0,
    failed: stats.failed ?? 0,
  })
})

/* ── POST /api/campaigns/send ──────────────────────────────────────────── */
// Creates the campaign row AND sends the first batch (up to BATCH_LIMIT).
// For audiences > BATCH_LIMIT, the frontend follows up with /send-batch.

campaigns.post('/send', requirePermission('campaigns.send'), async (c) => {
  const body = await readJsonOr(c, MAX_DASHBOARD_JSON_BYTES, null)
  if (!body) throw new HTTPException(400, { message: 'Invalid JSON body' })

  const { name, contactIds, templateName, templateLanguage = 'en' } = body

  if (!name?.trim()) throw new HTTPException(400, { message: 'Campaign name is required' })
  if (!templateName?.trim()) throw new HTTPException(400, { message: 'Template name is required' })
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    throw new HTTPException(400, { message: 'Select at least one contact' })
  }
  if (contactIds.length > MAX_RECIPIENTS) {
    throw new HTTPException(400, {
      message: `This send is capped at ${MAX_RECIPIENTS} recipients per campaign`,
    })
  }

  const allIds = contactIds.map(Number).filter(Number.isInteger)
  const limit = batchLimit(c.env)
  const batchIds = allIds.slice(0, limit)
  const remainingIds = allIds.slice(limit)

  const recipients = await loadRecipients(c.env.DB, batchIds)
  // Count the full audience for the campaign row (not just this batch).
  const totalRecipients = remainingIds.length > 0
    ? recipients.length + (await loadRecipients(c.env.DB, remainingIds)).length
    : recipients.length

  if (totalRecipients === 0) {
    throw new HTTPException(400, { message: 'None of the selected contacts can be messaged' })
  }

  const template = requestTemplate(body)
  const { variableMap, withComponents } = prepareSend(template, body.variableMap, addMediaMessage)

  const user = c.get('user')
  // Store the whole intended audience, not just this first batch. If the send
  // is interrupted later, this is the only record of who was meant to get it
  // — see migration 0006 and loadUnsentRecipients.
  const campaign = await c.env.DB.prepare(
    `INSERT INTO campaigns (name, template_name, template_language, status, total_count, created_by, variables, audience)
     VALUES (?, ?, ?, 'sending', ?, ?, ?, ?)
     RETURNING id`,
  ).bind(
    name.trim(), templateName.trim(), templateLanguage, totalRecipients, user?.id ?? null,
    withComponents ? JSON.stringify(variableMap) : null,
    JSON.stringify([...batchIds, ...remainingIds]),
  ).first()

  const campaignId = campaign.id

  const claimed = await claimRecipients(c.env.DB, campaignId, recipients)
  const run = claimed.length > 0
    ? await sendToRecipients(c.env, { recipients: claimed, templateName, templateLanguage, template, withComponents, variableMap })
    : NOTHING_SENT
  const next = await finishBatch(c.env.DB, campaignId, run, remainingIds)

  // `remaining` tells the frontend to continue with /send-batch.
  return ok(c, { campaignId, total: recipients.length, ...next })
})

/* ── POST /api/campaigns/send-batch ────────────────────────────────────── */
// Continues an in-progress campaign: sends the next chunk and returns any
// remaining IDs. The frontend loops until `remaining` is empty or absent.

campaigns.post('/send-batch', requirePermission('campaigns.send'), async (c) => {
  const body = await readJsonOr(c, MAX_DASHBOARD_JSON_BYTES, null)
  if (!body) throw new HTTPException(400, { message: 'Invalid JSON body' })

  const { campaignId, contactIds, templateName, templateLanguage = 'en' } = body

  if (!campaignId) throw new HTTPException(400, { message: 'campaignId is required' })
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    throw new HTTPException(400, { message: 'contactIds is required' })
  }

  const allIds = contactIds.map(Number).filter(Number.isInteger)
  const limit = batchLimit(c.env)
  const batchIds = allIds.slice(0, limit)
  const remainingIds = allIds.slice(limit)

  const template = requestTemplate(body)
  const { variableMap, withComponents } = prepareSend(template, body.variableMap, addMediaMessage)

  // Meta may have reported a spam or account block on an earlier batch by
  // webhook; nothing more goes out on this campaign until someone looks.
  const recorded = await recordedHalt(c.env.DB, Number(campaignId))
  if (recorded) return ok(c, await haltedBeforeSending(c.env.DB, Number(campaignId), recorded, allIds))

  const recipients = await loadRecipients(c.env.DB, batchIds)
  const claimed = await claimRecipients(c.env.DB, campaignId, recipients)
  const run = claimed.length > 0
    ? await sendToRecipients(c.env, { recipients: claimed, templateName, templateLanguage, template, withComponents, variableMap })
    : NOTHING_SENT
  const next = await finishBatch(c.env.DB, campaignId, run, remainingIds)

  // More to go: the frontend calls again with `remaining`.
  return ok(c, { campaignId, total: recipients.length, ...next })
})

/* ── GET /api/campaigns/:id/unsent ─────────────────────────────────────── */
// Who still hasn't received this campaign, and why. Powers the retry list in
// the UI: every contact here either failed or was never attempted, so the
// list empties itself as retries succeed — a contact that goes through gets a
// 'sent' row and stops matching.
//
// `?includeUnrecorded=1` opts into reconciling a pre-0006 campaign (one with
// no stored audience) against every eligible contact. Off by default because
// for a campaign that targeted a subset, that comparison would report every
// contact it deliberately skipped as a missed recipient.

campaigns.get('/:id/unsent', requirePermission('campaigns.view', 'campaigns.send'), async (c) => {
  const campaignId = Number(c.req.param('id'))
  if (!Number.isInteger(campaignId)) throw new HTTPException(400, { message: 'Invalid campaign id' })

  const campaign = await c.env.DB.prepare(
    `SELECT id, name, total_count, audience FROM campaigns WHERE id = ?`,
  ).bind(campaignId).first()
  if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' })

  const includeUnrecorded = c.req.query('includeUnrecorded') === '1'
  const { audienceSource, contacts, counts } = await loadUnsentRecipients(
    c.env.DB, campaign, { includeUnrecorded },
  )

  // A pre-0006 campaign that has more intended recipients than message rows is
  // hiding never-attempted contacts the caller can only see by opting in.
  const recorded = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT contact_id) AS n FROM messages WHERE campaign_id = ?`,
  ).bind(campaignId).first()
  const unaccounted = audienceSource === 'inferred' && !includeUnrecorded
    ? Math.max(0, (campaign.total_count ?? 0) - (recorded?.n ?? 0))
    : 0

  return ok(c, { campaignId, audienceSource, unaccounted, counts, contacts })
})

/* ── POST /api/campaigns/:id/retry ─────────────────────────────────────── */
// Retries everyone this campaign hasn't reached — never the ones who already
// got the message. That covers both a recipient Meta rejected (a `failed`
// row) and one the send never attempted at all (no row), which is what an
// interrupted campaign leaves behind; see loadUnsentRecipients.
//
// Omit `contactIds` to start a fresh round (the server re-derives who is
// outstanding right now); pass it back with the `remaining` from the previous
// response to continue one already in progress, same batching shape as /send
// + /send-batch. Safe to call again after a round still leaves failures — the
// outstanding set is recomputed each time, so it only ever shrinks.

campaigns.post('/:id/retry', requirePermission('campaigns.send'), async (c) => {
  const campaignId = Number(c.req.param('id'))
  if (!Number.isInteger(campaignId)) throw new HTTPException(400, { message: 'Invalid campaign id' })

  const campaign = await c.env.DB.prepare(
    `SELECT id, template_name, template_language, variables, audience, total_count FROM campaigns WHERE id = ?`,
  ).bind(campaignId).first()
  if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' })

  const body = (await readJsonOr(c, MAX_DASHBOARD_JSON_BYTES, {})) ?? {}
  const explicitIds = Array.isArray(body?.contactIds)
    ? body.contactIds.map(Number).filter(Number.isInteger)
    : null

  let outstandingIds = explicitIds
  if (!outstandingIds) {
    const { contacts } = await loadUnsentRecipients(c.env.DB, campaign, {
      includeUnrecorded: body?.includeUnrecorded === true,
    })
    outstandingIds = contacts.map((contact) => contact.id)
  }
  if (outstandingIds.length === 0) {
    throw new HTTPException(400, { message: 'Nothing left to retry on this campaign' })
  }

  const limit = batchLimit(c.env)
  const batchIds = outstandingIds.slice(0, limit)
  const remainingIds = outstandingIds.slice(limit)

  const template = await resolveCampaignTemplate(c.env, campaign.template_name, campaign.template_language)
  // A campaign sent before header files were kept has none to retry with.
  const { variableMap, withComponents } = prepareSend(
    template,
    campaign.variables ? JSON.parse(campaign.variables) : {},
    (kind) => `This campaign has no ${kind} saved for its ${kind} header, so it cannot be retried. Send it again as a new campaign with the ${kind} added.`,
  )

  // Filter to sendable contacts first (opted-out contacts are dropped by
  // loadRecipients and should keep their old failed row untouched, not get
  // claimed and left stuck at 'pending'), then atomically claim only those.
  //
  // The two kinds of outstanding recipient need opposite claims: one already
  // has a row to flip back to 'pending', the other has no row to flip and
  // needs one inserted. Both claims are atomic and both no-op against a row
  // that some overlapping retry already took, so whichever request gets there
  // first is the only one that sends — see claimFailedRecipients /
  // claimRecipients.
  const recorded = await recordedHalt(c.env.DB, campaignId)
  if (recorded) return ok(c, await haltedBeforeSending(c.env.DB, campaignId, recorded, outstandingIds))

  const candidates = await loadRecipients(c.env.DB, batchIds)
  const failedSet = new Set(await loadFailedContactIds(c.env.DB, campaignId))
  const [reclaimed, freshlyClaimed] = await Promise.all([
    claimFailedRecipients(c.env.DB, campaignId, candidates.filter((r) => failedSet.has(r.id))),
    claimRecipients(c.env.DB, campaignId, candidates.filter((r) => !failedSet.has(r.id))),
  ])
  const recipients = [...reclaimed, ...freshlyClaimed]

  const run = recipients.length > 0
    ? await sendToRecipients(c.env, {
      recipients,
      templateName: campaign.template_name,
      templateLanguage: campaign.template_language,
      template,
      withComponents,
      variableMap,
    })
    : NOTHING_SENT
  const next = await finishBatch(c.env.DB, campaignId, run, remainingIds)

  return ok(c, { campaignId, total: recipients.length, ...next })
})

/* ── POST /api/campaigns/header-media?format=VIDEO ─────────────────────────
   Uploads the file for a template's photo, video or document header to Meta
   once and returns its media ID, which every message in the campaign reuses.
   Meta keeps uploaded media for about 30 days, so nothing is stored here and
   Meta never has to fetch anything from us (the R2 bucket stays private). Needs
   campaigns.send, since the file goes out in paid sends; one Meta call each. */
const MB = 1024 * 1024

// MP4 and 3GP files both open with an ISO media box whose type is "ftyp".
function isIsoMedia(bytes) {
  const head = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength))
  return head.length === 8 && String.fromCharCode(head[4], head[5], head[6], head[7]) === 'ftyp'
}

const HEADER_MEDIA_RULES = {
  VIDEO: { types: ['video/mp4', 'video/3gpp'], maxBytes: 16 * MB, matches: (bytes) => isIsoMedia(bytes) },
  IMAGE: { types: ['image/jpeg', 'image/png'], maxBytes: 5 * MB, matches: (bytes, mime) => sniffType(bytes) === mime },
  DOCUMENT: { types: ['application/pdf'], maxBytes: 16 * MB, matches: (bytes, mime) => sniffType(bytes) === mime },
}

campaigns.post('/header-media', requirePermission('campaigns.send'), async (c) => {
  const format = String(c.req.query('format') || '').toUpperCase()
  const rule = HEADER_MEDIA_RULES[format]
  if (!rule) throw new HTTPException(400, { message: 'Unknown header type' })

  const form = await readBoundedFormData(c, rule.maxBytes + 64 * 1024)
  const file = formFile(form, 'file')
  if (!file) throw new HTTPException(400, { message: 'No file uploaded under the "file" field' })
  const mime = (file.type || '').split(';')[0].trim().toLowerCase()
  const kind = format.toLowerCase()
  if (!rule.types.includes(mime)) {
    throw new HTTPException(415, { message: format === 'VIDEO' ? 'Use an MP4 video.' : format === 'IMAGE' ? 'Use a JPEG or PNG image.' : 'Use a PDF document.' })
  }
  if (file.size > rule.maxBytes) {
    throw new HTTPException(413, { message: `The ${kind} must be ${rule.maxBytes / MB} MB or smaller.` })
  }
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0) throw new HTTPException(400, { message: 'The file is empty.' })
  if (!rule.matches(bytes, mime)) throw new HTTPException(415, { message: `The file is not a real ${kind}.` })

  const uploaded = await uploadMediaToMeta(c.env, { bytes, mime, filename: safeDisplayName(file.name, `header-${kind}`) })
  if (!uploaded.ok) throw new HTTPException(502, { message: `WhatsApp did not accept the file: ${uploaded.errorMessage}` })
  logEvent('campaigns.header_media.uploaded', { format, bytes: bytes.byteLength })
  return ok(c, { mediaId: uploaded.mediaId, size: bytes.byteLength })
})

export default campaigns
