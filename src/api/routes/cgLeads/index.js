import { Hono } from 'hono'
import { ok } from '../../utils/response.js'

const cgLeads = new Hono()

// GET /api/cg-leads/whatsapp-status — WhatsApp confirmation outcome per phone
// number, for the dashboard's Leads page. That page reads the lead rows
// (name/email/city/company) straight from Supabase `cg_leads`; this covers
// only the D1-tracked send outcome, joined client-side by phone since that's
// the only field the two databases share (cg_leads has no meta_message_id
// column — see cg-lead-whatsapp-confirmation memory for why status lives in
// D1's `messages` table instead of on the Supabase row).
//
// campaign_id IS NULL AND conversation_id IS NULL is what isolates cg-lead
// sends from every other writer to this table: campaign sends always set
// campaign_id (routes/campaigns/index.js claimRecipients), and inbox/agent
// replies always set conversation_id (routes/whatsapp/conversations.js). Only
// notifyCgLead (routes/public/index.js) produces a row matching neither.
// LIMIT 1000, most-recent-first: comfortably covers the WHATSAPP_CG_LEAD_DAILY_CAP
// (200/day) for several days, and the frontend only needs the latest status
// per phone.
cgLeads.get('/whatsapp-status', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT phone, status, error_code, error_message, meta_message_id,
            sent_at, delivered_at, read_at, failed_at
     FROM messages
     WHERE campaign_id IS NULL AND conversation_id IS NULL AND direction = 'outbound'
     ORDER BY created_at DESC
     LIMIT 1000`,
  ).all()

  return ok(c, { statuses: results })
})

export default cgLeads
