import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { sendTemplateMessage } from '../../services/whatsapp/graph.js'
import { buildComponents } from '../../../lib/templateVars.js'

const campaigns = new Hono()

// Each Meta send is one Workers subrequest. Paid plan allows 1000 per
// invocation, so a single request can handle ~900 recipients (leaving
// headroom for D1 queries). For larger audiences the frontend calls
// /send-batch repeatedly under the same campaignId.
const BATCH_LIMIT = 900
const MAX_RECIPIENTS = 2000
const CONCURRENCY = 8

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

// Loads contacts by chunked IDs (SQLite max 999 bind params).
async function loadRecipients(db, ids) {
  const recipients = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
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

// Sends to a list of recipients and writes message rows, returning totals.
async function sendAndLog(env, { campaignId, recipients, templateName, templateLanguage, template, hasVariables, variableMap }) {
  const outcomes = await mapWithConcurrency(recipients, CONCURRENCY, async (recipient) => {
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

  // D1 limits batch() to ~100 statements.
  const insertMessage = env.DB.prepare(
    `INSERT INTO messages
       (campaign_id, contact_id, phone, meta_message_id, status, error_code, error_message, sent_at, failed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const now = new Date().toISOString()

  const bindings = outcomes.map(({ recipient, result }) => insertMessage.bind(
    campaignId,
    recipient.id,
    recipient.phone,
    result.ok ? result.messageId : null,
    result.ok ? 'sent' : 'failed',
    result.ok ? null : result.errorCode,
    result.ok ? null : result.errorMessage,
    result.ok ? now : null,
    result.ok ? null : now,
  ))

  for (let i = 0; i < bindings.length; i += 100) {
    await env.DB.batch(bindings.slice(i, i + 100))
  }

  const sent = outcomes.filter(({ result }) => result.ok).length
  const failed = outcomes.length - sent
  const firstError = outcomes.find(({ result }) => !result.ok)?.result.errorMessage ?? null
  return { sent, failed, firstError }
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
  const batchIds = allIds.slice(0, BATCH_LIMIT)
  const remainingIds = allIds.slice(BATCH_LIMIT)

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

  const { sent, failed, firstError } = recipients.length > 0
    ? await sendAndLog(c.env, { campaignId, recipients, templateName, templateLanguage, template, hasVariables, variableMap })
    : { sent: 0, failed: 0, firstError: null }

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

  // Single-batch campaign: finalize immediately.
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `UPDATE campaigns
     SET sent_count = ?, failed_count = ?, status = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(sent, failed, sent > 0 ? 'completed' : 'failed', now, campaignId).run()

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
  const batchIds = allIds.slice(0, BATCH_LIMIT)
  const remainingIds = allIds.slice(BATCH_LIMIT)

  const recipients = await loadRecipients(c.env.DB, batchIds)
  const template = { headerText: templateHeader, bodyText: templateBody }
  const hasVariables = /\{\{/.test(templateHeader) || /\{\{/.test(templateBody)

  const { sent, failed, firstError } = recipients.length > 0
    ? await sendAndLog(c.env, { campaignId, recipients, templateName, templateLanguage, template, hasVariables, variableMap })
    : { sent: 0, failed: 0, firstError: null }

  // More to go — frontend calls again with the remaining IDs.
  if (remainingIds.length > 0) {
    return ok(c, { campaignId, total: recipients.length, sent, failed, firstError, remaining: remainingIds })
  }

  // Final batch: tally the full campaign and finalize.
  const now = new Date().toISOString()
  const totals = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM messages WHERE campaign_id = ?`,
  ).bind(campaignId).first()

  await c.env.DB.prepare(
    `UPDATE campaigns
     SET sent_count = ?, failed_count = ?, status = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(
    totals?.sent ?? sent, totals?.failed ?? failed,
    (totals?.sent ?? sent) > 0 ? 'completed' : 'failed', now, campaignId,
  ).run()

  return ok(c, { campaignId, total: recipients.length, sent, failed, firstError })
})

export default campaigns
