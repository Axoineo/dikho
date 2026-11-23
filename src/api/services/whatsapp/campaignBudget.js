import { logError, logEvent } from '../../utils/logger.js'

// Daily ceiling on WhatsApp campaign messages, across all staff
// (migrations/0014_campaign_send_budget.sql). Every recipient is reserved here
// before Meta is called, so the ceiling holds however many campaigns, batches or
// retries run at once.
//
// Fails CLOSED: an unset, invalid or zero WHATSAPP_CAMPAIGN_DAILY_CAP, or a
// database error, means nothing is sent. These are paid messages; a broken
// counter must not turn into unlimited sending.

/** The halt a campaign gets when the day's ceiling is reached. */
export const DAILY_LIMIT_HALT = {
  code: 'daily_limit',
  resumable: true,
  reason: "Today's limit for campaign messages is reached. Everyone not reached yet is in Not received: resume after midnight UTC (5:30 am IST), or ask an administrator to raise the limit.",
}

/** The halt a campaign gets when the ceiling cannot be checked. */
export const BUDGET_UNAVAILABLE_HALT = {
  code: 'budget_unavailable',
  resumable: true,
  reason: 'Sending is not available right now. Nothing more was sent; try again in a few minutes.',
}

const today = () => new Date().toISOString().slice(0, 10)

function dailyCap(env) {
  const cap = Number(env.WHATSAPP_CAMPAIGN_DAILY_CAP)
  return Number.isInteger(cap) && cap > 0 ? cap : null
}

/**
 * Reserves up to `count` sends against today's ceiling. Returns how many were
 * granted (0 to count), or null when the ceiling could not be checked, in which
 * case nothing may be sent.
 *
 * One D1 batch, which runs as a single transaction: the row for today is made if
 * missing, read, and raised by at most what is left. What was granted is the
 * difference between the two reads, so two requests at once can never both get
 * the last places.
 */
export async function reserveCampaignSends(env, count) {
  if (!(count > 0)) return 0
  const cap = dailyCap(env)
  if (cap === null) {
    logEvent('campaigns.budget_misconfigured', {})
    return null
  }
  const day = today()
  try {
    const [, before, after] = await env.DB.batch([
      env.DB.prepare('INSERT INTO campaign_send_budget (day, sent) VALUES (?1, 0) ON CONFLICT(day) DO NOTHING').bind(day),
      env.DB.prepare('SELECT sent FROM campaign_send_budget WHERE day = ?1').bind(day),
      env.DB.prepare('UPDATE campaign_send_budget SET sent = MIN(sent + ?2, MAX(sent, ?3)) WHERE day = ?1 RETURNING sent').bind(day, count, cap),
    ])
    const was = Number(before?.results?.[0]?.sent)
    const now = Number(after?.results?.[0]?.sent)
    if (!Number.isFinite(was) || !Number.isFinite(now)) throw new Error('budget row missing')
    const granted = Math.min(count, Math.max(0, now - was))
    if (granted < count) logEvent('campaigns.daily_cap_reached', { cap, asked: count, granted })
    else if (was < cap * 0.8 && now >= cap * 0.8) logEvent('campaigns.budget_80pct', { cap, sent: now })
    return granted
  } catch (err) {
    logError('campaigns.budget_check_failed', err)
    return null
  }
}

/** Gives back places reserved for recipients that were never attempted. */
export async function releaseCampaignSends(env, count) {
  if (!(count > 0)) return
  try {
    await env.DB.prepare('UPDATE campaign_send_budget SET sent = MAX(sent - ?2, 0) WHERE day = ?1').bind(today(), count).run()
  } catch (err) {
    // Only makes the ceiling a little stricter for the rest of the day.
    logError('campaigns.budget_release_failed', err)
  }
}
