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

// Approved templates for the WABA. Callers fall back to a static definition
// when this fails, so a Meta outage never blocks the campaign screen.
export async function fetchApprovedTemplates(env) {
  const res = await fetch(
    graphUrl(`${env.WHATSAPP_WABA_ID}/message_templates?status=APPROVED&limit=100`),
    { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } },
  )
  if (!res.ok) throw new Error(`Template fetch failed with status ${res.status}`)

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
