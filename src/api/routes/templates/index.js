import { Hono } from 'hono'
import { ok } from '../../utils/response.js'
import { fetchApprovedTemplates } from '../../services/whatsapp/graph.js'
import { logError } from '../../utils/logger.js'
import { templateTokens } from '../../../lib/templateVars.js'

const templates = new Hono()

// Used when the Graph API is unreachable or credentials are not set yet, so
// the campaign screen still renders with the one approved static template.
function staticFallback(env) {
  return [{
    name: env.WHATSAPP_STATIC_TEMPLATE_NAME || 'september_offer',
    language: env.WHATSAPP_STATIC_TEMPLATE_LANG || 'en',
    category: 'MARKETING',
    status: 'APPROVED',
    headerText: '',
    bodyText: 'Your approved template body will appear here once the Meta credentials are configured.',
    footerText: '',
    buttons: [],
  }]
}

// GET /api/templates — approved templates only. `variables` lists the distinct
// {{...}} tokens (positional {{1}} or named {{name}}) the wizard maps to
// contact columns; `hasVariables` is the convenience flag.
templates.get('/', async (c) => {
  let list
  let source = 'meta'

  try {
    list = await fetchApprovedTemplates(c.env)
    if (list.length === 0) { list = staticFallback(c.env); source = 'fallback' }
  } catch (err) {
    logError('templates.fetch_failed', err)
    list = staticFallback(c.env)
    source = 'fallback'
  }

  const withMeta = list.map((template) => {
    const variables = templateTokens(template)
    return { ...template, variables, hasVariables: variables.length > 0 }
  })

  return ok(c, { templates: withMeta, source })
})

export default templates
