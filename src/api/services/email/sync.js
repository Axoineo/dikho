import { callUserRpc } from '../userAdmin.js'
import { gmail, gmailBatchGet, GmailError, GoogleAuthError } from './google.js'
import { TokenKeyError } from './crypto.js'
import { METADATA_QUERY, summarizeThread } from './mime.js'
import { pushConfigured, syncDays, syncMaxThreads } from './config.js'
import { logError, logEvent } from '../../utils/logger.js'

// Keeps the cached thread metadata in step with Gmail.
//
//   Full sync: the mailbox's current history id is read FIRST, then the newest
//   threads (EMAIL_SYNC_DAYS / EMAIL_SYNC_MAX_THREADS) are listed and their
//   metadata fetched in Gmail batches. Anything that changes meanwhile is
//   picked up by the next incremental run from that history id.
//   Incremental: Gmail's history since the stored cursor names the threads
//   that changed; only those are re-read. An expired cursor (404) or a burst
//   of changes too large for one run falls back to a full sync.
//
// Each run holds a database lease (em_claim_sync), so two isolates, a push and
// a page visit, never sync one mailbox at once. Runs are sized for the
// Workers Free limit of 50 subrequests per invocation: about 15 for a full
// sync of 150 threads, fewer for an incremental one.
//
// Triggers (no cron needed): Gmail push via Pub/Sub, someone opening the
// Email Hub (maybeSyncForUser), and "Sync now".

const rpc = (env, fn, args) => callUserRpc({ env }, fn, args)
const HEX_ID = /^[0-9a-f]{1,32}$/
const DAY_MS = 86_400_000

async function refreshThreads(env, account, ids) {
  const summaries = []
  const deleted = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const results = await gmailBatchGet(env, account, chunk.map((id) => `/threads/${id}?${METADATA_QUERY}`))
    results.forEach((result, j) => {
      if (result?.error === 404) deleted.push(chunk[j])
      else if (!result?.error) {
        const summary = summarizeThread(result)
        if (summary) summaries.push(summary)
      }
    })
  }
  for (let i = 0; i < summaries.length; i += 100) {
    await rpc(env, 'em_upsert_threads', { p_account: account.id, p_threads: summaries.slice(i, i + 100) })
  }
  if (deleted.length) await rpc(env, 'em_mark_threads_deleted', { p_account: account.id, p_gmail_thread_ids: deleted })
  return { updated: summaries.length, deleted: deleted.length }
}

async function fullSync(env, account) {
  const profile = await gmail(env, account, '/profile')
  const historyId = String(profile?.historyId ?? '')
  const max = syncMaxThreads(env)
  const ids = []
  let pageToken
  do {
    const query = new URLSearchParams({ maxResults: String(Math.min(50, max - ids.length)), q: `newer_than:${syncDays(env)}d` })
    if (pageToken) query.set('pageToken', pageToken)
    const page = await gmail(env, account, '/threads', { query: query.toString() })
    for (const t of page?.threads ?? []) if (HEX_ID.test(t?.id ?? '')) ids.push(t.id)
    pageToken = page?.nextPageToken
  } while (pageToken && ids.length < max)
  const counts = await refreshThreads(env, account, ids)
  return { historyId, ...counts }
}

const HISTORY_KEYS = ['messages', 'messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved']

async function incrementalSync(env, account, startHistoryId) {
  const changed = new Set()
  let latest = startHistoryId
  let pageToken
  let pages = 0
  do {
    const query = new URLSearchParams({ startHistoryId, maxResults: '500' })
    for (const type of ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']) query.append('historyTypes', type)
    if (pageToken) query.set('pageToken', pageToken)
    let page
    try {
      page = await gmail(env, account, '/history', { query: query.toString() })
    } catch (err) {
      // Gmail keeps history for about a week; older cursors are refused.
      if (err instanceof GmailError && err.status === 404) return { restart: true }
      throw err
    }
    for (const record of page?.history ?? []) {
      for (const key of HISTORY_KEYS) {
        for (const item of record?.[key] ?? []) {
          const threadId = item?.threadId ?? item?.message?.threadId
          if (HEX_ID.test(threadId ?? '')) changed.add(threadId)
        }
      }
    }
    if (page?.historyId) latest = String(page.historyId)
    pageToken = page?.nextPageToken
    if (++pages >= 5 || changed.size > 200) return { restart: true }
  } while (pageToken)

  const counts = await refreshThreads(env, account, [...changed])
  return { historyId: latest, ...counts }
}

async function startWatch(env, account) {
  const result = await gmail(env, account, '/watch', {
    method: 'POST',
    body: { topicName: env.GOOGLE_PUBSUB_TOPIC },
  })
  const expires = Number(result?.expiration)
  return Number.isFinite(expires) && expires > Date.now() ? new Date(expires).toISOString() : null
}

/** Best effort, before a disconnect: stop Gmail pushing for this mailbox. */
export async function stopWatch(env, account) {
  try {
    await gmail(env, account, '/stop', { method: 'POST', body: {} })
  } catch { /* the grant may already be gone */ }
}

/**
 * Syncs one mailbox if no other run holds it. Never throws: the outcome is
 * recorded on the mailbox (last_synced_at / last_sync_error / status).
 */
export async function syncMailbox(env, accountId) {
  let claim
  try {
    claim = await rpc(env, 'em_claim_sync', { p_account: accountId, p_lease_seconds: 120 })
  } catch (err) {
    logError('email.sync.claim_failed', err)
    return { ok: false }
  }
  if (!claim) return { skipped: true }
  const account = { id: claim.id, email_address: claim.email_address, token_enc: claim.token_enc }
  let full = Boolean(claim.needs_full_sync || !claim.history_id)

  try {
    let result
    if (!full) {
      result = await incrementalSync(env, account, claim.history_id)
      if (result.restart) full = true
    }
    if (full) result = await fullSync(env, account)

    let watchExpiresAt = null
    const watchUntil = Date.parse(claim.watch_expires_at || '') || 0
    if (pushConfigured(env) && watchUntil < Date.now() + DAY_MS) {
      try {
        watchExpiresAt = await startWatch(env, account)
      } catch (err) {
        if (err instanceof GoogleAuthError) throw err
        logError('email.sync.watch_failed', err)
      }
    }

    await rpc(env, 'em_finish_sync', {
      p_account: account.id, p_history_id: result.historyId, p_full: full, p_error: null, p_watch_expires_at: watchExpiresAt,
    })
    logEvent('email.sync.done', { full, updated: result.updated, deleted: result.deleted, watch: Boolean(watchExpiresAt) })
    return { ok: true, full, updated: result.updated }
  } catch (err) {
    try {
      if (err instanceof GoogleAuthError) {
        await rpc(env, 'em_mark_account', {
          p_account: account.id, p_state: 'reauth_required',
          p_error: 'Google no longer accepts Dikho\'s access to this mailbox. Reconnect it.',
        })
      } else {
        const message = err instanceof GmailError ? err.message
          : err instanceof TokenKeyError ? 'The stored sign-in cannot be read with the current key. An administrator needs to check EMAIL_TOKEN_KEY.'
            : 'Sync failed and will be retried.'
        if (!(err instanceof GmailError)) logError('email.sync.failed', err)
        await rpc(env, 'em_finish_sync', {
          p_account: account.id, p_history_id: null, p_full: false, p_error: message, p_watch_expires_at: null,
        })
      }
    } catch (inner) {
      // The lease runs out on its own; the next run retries.
      logError('email.sync.record_failed', inner)
    }
    return { ok: false }
  }
}

/** Runs work after the response, where the platform allows it. */
export function inBackground(c, promise) {
  try {
    c.executionCtx.waitUntil(promise)
  } catch {
    promise.catch(() => {})
  }
}

// One background sync per person per minute per isolate, of at most one
// mailbox, so the request that triggers it stays within its subrequest budget.
const lastKick = new Map()

export function maybeSyncForUser(c, userId) {
  const now = Date.now()
  if ((lastKick.get(userId) ?? 0) > now - 60_000) return
  lastKick.set(userId, now)
  if (lastKick.size > 500) lastKick.clear()
  inBackground(c, (async () => {
    try {
      const due = await rpc(c.env, 'em_sync_due', { p_user: userId, p_limit: 1 })
      if (Array.isArray(due) && due[0]) await syncMailbox(c.env, due[0])
    } catch (err) {
      logError('email.sync.kick_failed', err)
    }
  })())
}
