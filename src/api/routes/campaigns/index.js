import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { fetchApprovedTemplates, sendTemplateMessage } from '../../services/whatsapp/graph.js'
import { buildComponents } from '../../../lib/templateVars.js'

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

function parseAttributes(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

// Runs `worker` over `items` with a fixed number of parallel lanes, preserving
// result order. Keeps the Meta API from being hit with 500 simultaneous calls.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0

  async function lane() {
    while (cursor < items.length) {
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

// Sends to a list of already-claimed recipients, returning per-recipient
// outcomes. Persistence (finalizeMessages) is a separate step so callers
// that claimed via INSERT vs UPDATE can share this.
async function sendToRecipients(env, { recipients, templateName, templateLanguage, template, hasVariables, variableMap }) {
  return mapWithConcurrency(recipients, concurrency(env), async (recipient) => {
    const contact = { ...recipient, attributes: parseAttributes(recipient.attributes) }
    const components = hasVariables ? buildComponents(template, variableMap, contact) : undefined

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
    return { recipient, result }
  })
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

campaigns.get('/', async (c) => {
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

campaigns.get('/stats', async (c) => {
  const [contactCount, campaignCount, messageStats] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) AS total FROM contacts WHERE opted_out = 0'),
    c.env.DB.prepare('SELECT COUNT(*) AS total FROM campaigns'),
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) AS read_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM messages`,
    ),
  ])

  const stats = messageStats.results[0] ?? {}
  return ok(c, {
    contacts: contactCount.results[0]?.total ?? 0,
    campaigns: campaignCount.results[0]?.total ?? 0,
    messages: stats.total ?? 0,
    sent: stats.sent ?? 0,
    delivered: stats.delivered ?? 0,
    read: stats.read_count ?? 0,
    failed: stats.failed ?? 0,
  })
})

/* ── POST /api/campaigns/send ──────────────────────────────────────────── */
// Creates the campaign row AND sends the first batch (up to BATCH_LIMIT).
// For audiences > BATCH_LIMIT, the frontend follows up with /send-batch.

campaigns.post('/send', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) throw new HTTPException(400, { message: 'Invalid JSON body' })

  const {
    name, contactIds, templateName, templateLanguage = 'en',
    templateHeader = '', templateBody = '', variableMap = {},
  } = body

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

  const template = { headerText: templateHeader, bodyText: templateBody }
  const hasVariables = /\{\{/.test(templateHeader) || /\{\{/.test(templateBody)

  const user = c.get('user')
  const campaign = await c.env.DB.prepare(
    `INSERT INTO campaigns (name, template_name, template_language, status, total_count, created_by, variables)
     VALUES (?, ?, ?, 'sending', ?, ?, ?)
     RETURNING id`,
  ).bind(
    name.trim(), templateName.trim(), templateLanguage, totalRecipients, user?.id ?? null,
    hasVariables ? JSON.stringify(variableMap) : null,
  ).first()

  const campaignId = campaign.id

  const claimed = await claimRecipients(c.env.DB, campaignId, recipients)
  const outcomes = claimed.length > 0
    ? await sendToRecipients(c.env, { recipients: claimed, templateName, templateLanguage, template, hasVariables, variableMap })
    : []
  await finalizeMessages(c.env.DB, campaignId, outcomes)
  const { sent, failed, firstError } = summarizeOutcomes(outcomes)

  await updateCampaignProgress(c.env.DB, campaignId, { final: remainingIds.length === 0 })

  // If there are remaining IDs, tell the frontend to continue with /send-batch.
  if (remainingIds.length > 0) {
    return ok(c, {
      campaignId,
      total: recipients.length,
      sent,
      failed,
      firstError,
      remaining: remainingIds,
    })
  }

  return ok(c, { campaignId, total: recipients.length, sent, failed, firstError })
})

/* ── POST /api/campaigns/send-batch ────────────────────────────────────── */
// Continues an in-progress campaign: sends the next chunk and returns any
// remaining IDs. The frontend loops until `remaining` is empty or absent.

campaigns.post('/send-batch', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) throw new HTTPException(400, { message: 'Invalid JSON body' })

  const {
    campaignId, contactIds, templateName, templateLanguage = 'en',
    templateHeader = '', templateBody = '', variableMap = {},
  } = body

  if (!campaignId) throw new HTTPException(400, { message: 'campaignId is required' })
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    throw new HTTPException(400, { message: 'contactIds is required' })
  }

  const allIds = contactIds.map(Number).filter(Number.isInteger)
  const limit = batchLimit(c.env)
  const batchIds = allIds.slice(0, limit)
  const remainingIds = allIds.slice(limit)

  const recipients = await loadRecipients(c.env.DB, batchIds)
  const template = { headerText: templateHeader, bodyText: templateBody }
  const hasVariables = /\{\{/.test(templateHeader) || /\{\{/.test(templateBody)

  const claimed = await claimRecipients(c.env.DB, campaignId, recipients)
  const outcomes = claimed.length > 0
    ? await sendToRecipients(c.env, { recipients: claimed, templateName, templateLanguage, template, hasVariables, variableMap })
    : []
  await finalizeMessages(c.env.DB, campaignId, outcomes)
  const { sent, failed, firstError } = summarizeOutcomes(outcomes)

  await updateCampaignProgress(c.env.DB, campaignId, { final: remainingIds.length === 0 })

  // More to go — frontend calls again with the remaining IDs.
  if (remainingIds.length > 0) {
    return ok(c, { campaignId, total: recipients.length, sent, failed, firstError, remaining: remainingIds })
  }

  return ok(c, { campaignId, total: recipients.length, sent, failed, firstError })
})

/* ── POST /api/campaigns/:id/retry ─────────────────────────────────────── */
// Retries only the currently-failed recipients of a campaign — never the ones
// who already got the message. Omit `contactIds` to start a fresh retry round
// (the server looks up whoever is failed right now); pass it back with the
// `remaining` from the previous response to continue one already in progress,
// same batching shape as /send + /send-batch. Safe to call again after a
// retry round still leaves failures — it just re-derives the (now smaller)
// failed set and goes again.

campaigns.post('/:id/retry', async (c) => {
  const campaignId = Number(c.req.param('id'))
  if (!Number.isInteger(campaignId)) throw new HTTPException(400, { message: 'Invalid campaign id' })

  const campaign = await c.env.DB.prepare(
    `SELECT id, template_name, template_language, variables FROM campaigns WHERE id = ?`,
  ).bind(campaignId).first()
  if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' })

  const body = await c.req.json().catch(() => ({}))
  const explicitIds = Array.isArray(body?.contactIds)
    ? body.contactIds.map(Number).filter(Number.isInteger)
    : null

  const failedIds = explicitIds ?? await loadFailedContactIds(c.env.DB, campaignId)
  if (failedIds.length === 0) {
    throw new HTTPException(400, { message: 'No failed messages to retry' })
  }

  const limit = batchLimit(c.env)
  const batchIds = failedIds.slice(0, limit)
  const remainingIds = failedIds.slice(limit)

  const template = await resolveCampaignTemplate(c.env, campaign.template_name, campaign.template_language)
  const variableMap = campaign.variables ? JSON.parse(campaign.variables) : {}
  const hasVariables = /\{\{/.test(template.headerText) || /\{\{/.test(template.bodyText)

  // Filter to sendable contacts first (opted-out contacts are dropped by
  // loadRecipients and should keep their old failed row untouched, not get
  // claimed and left stuck at 'pending'), then atomically claim only those —
  // see claimFailedRecipients for why this makes overlapping retries safe.
  const candidates = await loadRecipients(c.env.DB, batchIds)
  const recipients = await claimFailedRecipients(c.env.DB, campaignId, candidates)

  const outcomes = recipients.length > 0
    ? await sendToRecipients(c.env, {
      recipients,
      templateName: campaign.template_name,
      templateLanguage: campaign.template_language,
      template,
      hasVariables,
      variableMap,
    })
    : []
  await finalizeMessages(c.env.DB, campaignId, outcomes)
  const { sent, failed, firstError } = summarizeOutcomes(outcomes)

  await updateCampaignProgress(c.env.DB, campaignId, { final: remainingIds.length === 0 })

  if (remainingIds.length > 0) {
    return ok(c, { campaignId, total: recipients.length, sent, failed, firstError, remaining: remainingIds })
  }

  return ok(c, { campaignId, total: recipients.length, sent, failed, firstError })
})

export default campaigns
