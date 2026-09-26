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
  // Store the whole intended audience, not just this first batch. If the send
  // is interrupted later, this is the only record of who was meant to get it
  // — see migration 0006 and loadUnsentRecipients.
  const campaign = await c.env.DB.prepare(
    `INSERT INTO campaigns (name, template_name, template_language, status, total_count, created_by, variables, audience)
     VALUES (?, ?, ?, 'sending', ?, ?, ?, ?)
     RETURNING id`,
  ).bind(
    name.trim(), templateName.trim(), templateLanguage, totalRecipients, user?.id ?? null,
    hasVariables ? JSON.stringify(variableMap) : null,
    JSON.stringify([...batchIds, ...remainingIds]),
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

campaigns.get('/:id/unsent', async (c) => {
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

campaigns.post('/:id/retry', async (c) => {
  const campaignId = Number(c.req.param('id'))
  if (!Number.isInteger(campaignId)) throw new HTTPException(400, { message: 'Invalid campaign id' })

  const campaign = await c.env.DB.prepare(
    `SELECT id, template_name, template_language, variables, audience, total_count FROM campaigns WHERE id = ?`,
  ).bind(campaignId).first()
  if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' })

  const body = await c.req.json().catch(() => ({}))
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
  const variableMap = campaign.variables ? JSON.parse(campaign.variables) : {}
  const hasVariables = /\{\{/.test(template.headerText) || /\{\{/.test(template.bodyText)

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
  const candidates = await loadRecipients(c.env.DB, batchIds)
  const failedSet = new Set(await loadFailedContactIds(c.env.DB, campaignId))
  const [reclaimed, freshlyClaimed] = await Promise.all([
    claimFailedRecipients(c.env.DB, campaignId, candidates.filter((r) => failedSet.has(r.id))),
    claimRecipients(c.env.DB, campaignId, candidates.filter((r) => !failedSet.has(r.id))),
  ])
  const recipients = [...reclaimed, ...freshlyClaimed]

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
