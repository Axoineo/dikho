// Meta WhatsApp Cloud API client. Every credential is read from c.env —
// nothing is hardcoded, and tokens are never included in thrown errors or logs.

const GRAPH_VERSION = 'v21.0'

function graphUrl(path) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`
}

// Sends one approved STATIC template (no `components` — this phase has no
// variables to map). When variable templates arrive, add a `components`
// argument here rather than at the call site.
export async function sendTemplateMessage(env, { to, templateName, languageCode = 'en' }) {
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
      template: { name: templateName, language: { code: languageCode } },
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

// Sends a plain text reply. preview_url lets Meta render link previews.
export async function sendTextMessage(env, { to, body }) {
  return postMessage(env, { to, type: 'text', text: { preview_url: true, body } })
}

// Sends a media reply by Meta media id (obtained from uploadMediaToMeta). A
// caption is allowed on image/document/video but not audio; documents may carry
// a filename shown to the recipient.
export async function sendMediaMessage(env, { to, type, mediaId, caption, filename }) {
  const media = { id: mediaId }
  if (caption && type !== 'audio') media.caption = caption
  if (type === 'document' && filename) media.filename = filename
  return postMessage(env, { to, type, [type]: media })
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
