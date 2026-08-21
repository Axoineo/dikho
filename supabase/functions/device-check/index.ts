import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Verify caller identity via their JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Use the caller's JWT to resolve and validate the user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    // 2. Validate device_id from request body
    let body: { device_id?: unknown }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const device_id = body.device_id
    if (
      typeof device_id !== 'string' ||
      device_id.length === 0 ||
      device_id.length > 128
    ) {
      return json({ error: 'Invalid device_id' }, 400)
    }

    // 3. Check / register device using service role (bypasses RLS for writes)
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: existing } = await admin
      .from('user_devices')
      .select('id')
      .eq('user_id', user.id)
      .eq('device_id', device_id)
      .maybeSingle()

    const isNew = !existing

    if (isNew) {
      // Register the new device
      await admin.from('user_devices').insert({
        user_id: user.id,
        device_id,
        label: 'web',
      })

      // Send security alert — failure never blocks login
      await sendSecurityAlert(user.email ?? '')
    }

    // Always record a login event
    await admin.from('login_events').insert({
      user_id: user.id,
      device_id,
      is_new: isNew,
    })

    return json({ known: !isNew })
  } catch (err) {
    console.error(
      '[device-check] Unhandled error:',
      err instanceof Error ? err.message : err,
    )
    return json({ error: 'Internal error' }, 500)
  }
})

// Helpers

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendSecurityAlert(toEmail: string): Promise<void> {
  if (!toEmail) return

  const brevoKey = Deno.env.get('BREVO_API_KEY')
  const senderEmail =
    Deno.env.get('BREVO_SENDER_EMAIL') ?? 'security@dikho.in'

  if (!brevoKey) {
    console.warn('[device-check] BREVO_API_KEY not set — skipping alert email')
    return
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Dikho Security', email: senderEmail },
        to: [{ email: toEmail }],
        subject: 'New device sign-in to your Dikho account',
        htmlContent: `
<p style="font-family:sans-serif;font-size:15px;color:#263247;">Hi,</p>
<p style="font-family:sans-serif;font-size:15px;color:#263247;">
  A new device just signed in to your <strong>Dikho</strong> account.
</p>
<p style="font-family:sans-serif;font-size:15px;color:#263247;">
  If this was you, no action is needed.<br>
  If this was <strong>not</strong> you, please contact your administrator immediately.
</p>
<p style="font-family:sans-serif;font-size:13px;color:#718098;">&#8212; Dikho Security</p>
        `,
      }),
    })

    if (!res.ok) {
      const responseBody = await res.text()
      console.warn('[device-check] Brevo API error:', res.status, responseBody)
    }
  } catch (err) {
    // Never propagate email failures
    console.warn(
      '[device-check] Failed to send alert email:',
      err instanceof Error ? err.message : err,
    )
  }
}
