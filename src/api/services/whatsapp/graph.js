// Meta WhatsApp Cloud API client. Every credential is read from c.env —
// nothing is hardcoded, and tokens are never included in thrown errors or logs.

const GRAPH_VERSION = 'v21.0'

function graphUrl(path) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`
}

// Sends one approved template. `components` carries per-recipient variable
// values (header/body parameters) built by lib/templateVars.buildComponents;
// omit it for a static template and Meta receives no `components` key.
export async function sendTemplateMessage(env, { to, templateName, languageCode = 'en', components }) {
  const template = { name: templateName, language: { code: languageCode } }
  if (Array.isArray(components) && components.length > 0) template.components = components

  const res = await fetch(graphUrl(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template,
    }),
  })

  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    const error = body?.error ?? {}
    return {
      ok: false,
      errorCode: String(error.code ?? res.status),
      errorMessage: error.message ?? 'Meta API request failed',
    }
  }

  return { ok: true, messageId: body?.messages?.[0]?.id ?? null }
}

// Sends a one-time login code through an approved AUTHENTICATION-category
// template (default `dikho_auth`). Meta requires the code twice: once as the
// body variable and once as the copy-code button parameter. The code is never
// logged or included in a returned error.
//
// If the template was created without a copy-code/one-tap button, Meta rejects
// the button component — drop it here and keep only the body parameter.
export async function sendAuthTemplate(env, { to, code }) {
  const templateName = env.WHATSAPP_AUTH_TEMPLATE_NAME || 'dikho_auth'
  const languageCode = env.WHATSAPP_AUTH_TEMPLATE_LANG || 'en'

  const res = await fetch(graphUrl(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    }),
  })

  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    const error = body?.error ?? {}
    return {
      ok: false,
      errorCode: String(error.code ?? res.status),
      errorMessage: error.message ?? 'Meta API request failed',
    }
  }

  return { ok: true, messageId: body?.messages?.[0]?.id ?? null }
}

// Shared sender for free-form (non-template) messages inside an open 24-hour
// session. Same error contract as sendTemplateMessage: { ok, messageId } or
// { ok:false, errorCode, errorMessage }. Never includes the token in an error.
async function postMessage(env, message) {
  const res = await fetch(graphUrl(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...message,
    }),
  })

  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    const error = body?.error ?? {}
    return {
      ok: false,
      errorCode: String(error.code ?? res.status),
      errorMessage: error.message ?? 'Meta API request failed',
    }
  }

  return { ok: true, messageId: body?.messages?.[0]?.id ?? null }
}

// `contextWamid` makes the message a reply that quotes an earlier one (Meta's
// contextual replies). WhatsApp shows the quote only while the original is
// under about 30 days old; the reply itself is delivered either way.
function withContext(message, contextWamid) {
  return contextWamid ? { ...message, context: { message_id: contextWamid } } : message
}

// Sends a plain text reply. preview_url lets Meta render link previews.
export async function sendTextMessage(env, { to, body, contextWamid }) {
  return postMessage(env, withContext({ to, type: 'text', text: { preview_url: true, body } }, contextWamid))
}

// Sends a media reply by Meta media id (obtained from uploadMediaToMeta). A
// caption is allowed on image/document/video but not audio; documents may carry
// a filename shown to the recipient.
export async function sendMediaMessage(env, { to, type, mediaId, caption, filename, contextWamid }) {
  const media = { id: mediaId }
  if (caption && type !== 'audio') media.caption = caption
  if (type === 'document' && filename) media.filename = filename
  return postMessage(env, withContext({ to, type, [type]: media }, contextWamid))
}

// Reacts to a message with one emoji; an empty emoji takes the reaction off.
// Meta refuses reactions to messages over 30 days old and to other reactions
// (error 131009), and reports only a `sent` status for them, never delivered
// or read.
export async function sendReaction(env, { to, messageWamid, emoji }) {
  return postMessage(env, { to, type: 'reaction', reaction: { message_id: messageWamid, emoji } })
}

// Marks an inbound message as read (blue ticks on the customer's side) and,
// optionally, shows a "typing…" indicator to the customer. Meta bundles typing
// with the read receipt: it displays for up to ~25s or until a message is sent.
// Best-effort — callers fire it via waitUntil and ignore failures.
export async function markMessageRead(env, { messageId, typing = false }) {
  const body = { messaging_product: 'whatsapp', status: 'read', message_id: messageId }
  if (typing) body.typing_indicator = { type: 'text' }

  const res = await fetch(graphUrl(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    return { ok: false, errorCode: String(b?.error?.code ?? res.status), errorMessage: b?.error?.message ?? 'read receipt failed' }
  }
  return { ok: true }
}

const BLOCK_TIMEOUT_MS = 10_000

// Adds one number to, or removes it from, the business's WhatsApp block list
// (Cloud API Block Users: POST / DELETE /{phone-number-id}/block_users). A
// blocked user cannot message the business and the business cannot message
// them. Meta only lets a business block someone who messaged it in the last
// 24 hours (error 131047); unblocking has no such window.
//
// Meta answers per user, and a refusal arrives as BOTH a `failed_users` entry
// and a top-level 139100 "failed to block/unblock users" error. The user's own
// entry is the useful one, so it wins over the generic error. Anything short
// of Meta confirming the user is a failure: the caller only records a block
// that Meta actually applied. Same error contract as postMessage.
async function updateBlockList(env, method, phone) {
  let res
  try {
    res = await fetch(graphUrl(`${env.WHATSAPP_PHONE_NUMBER_ID}/block_users`), {
      method,
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', block_users: [{ user: `+${phone}` }] }),
      signal: AbortSignal.timeout(BLOCK_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, errorCode: 'UNREACHABLE', errorMessage: 'Could not reach WhatsApp.' }
  }

  const body = await res.json().catch(() => ({}))
  const result = body?.block_users ?? {}
  const done = method === 'POST' ? result.added_users : result.removed_users
  if (res.ok && !body?.error && Array.isArray(done) && done.length > 0) return { ok: true }

  const error = result.failed_users?.[0]?.errors?.[0] ?? body?.error ?? {}
  return {
    ok: false,
    errorCode: String(error.code ?? res.status),
    errorMessage: error.error_data?.details ?? error.message ?? 'Meta API request failed',
  }
}

export function blockUser(env, { phone }) {
  return updateBlockList(env, 'POST', phone)
}

export function unblockUser(env, { phone }) {
  return updateBlockList(env, 'DELETE', phone)
}

// Approved templates for the WABA. Callers fall back to a static definition
// when this fails, so a Meta outage never blocks the campaign screen.
export async function fetchApprovedTemplates(env) {
  const res = await fetch(
    graphUrl(`${env.WHATSAPP_WABA_ID}/message_templates?status=APPROVED&limit=100`),
    { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } },
  )
  if (!res.ok) {
    // Surface Meta's own error (code/message/fbtrace_id) rather than a bare
    // HTTP status — code 190 => token, 100 => bad WABA id/param, 200 => missing
    // permission. The token itself is never part of this body, so it is safe
    // to log. Truncated to keep a single log line readable.
    const detail = await res.text().catch(() => '')
    throw new Error(`Template fetch failed (HTTP ${res.status}): ${detail.slice(0, 500)}`)
  }

  const body = await res.json()
  return (body.data ?? []).map((template) => ({
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    bodyText: template.components?.find((component) => component.type === 'BODY')?.text ?? '',
    headerText: template.components?.find((component) => component.type === 'HEADER')?.text ?? '',
    footerText: template.components?.find((component) => component.type === 'FOOTER')?.text ?? '',
    buttons: template.components?.find((component) => component.type === 'BUTTONS')?.buttons ?? [],
  }))
}
