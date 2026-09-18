import { AwsClient } from 'aws4fetch'

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    
    if (url.pathname.startsWith('/api/catalogue/')) {
      const AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
      const AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;
      const AWS_REGION = env.AWS_REGION;
      const S3_BUCKET_NAME = env.S3_BUCKET_NAME;
      const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

      if (url.pathname === '/api/catalogue/leads' && request.method === 'POST') {
        try {
          const body = await request.json()
          const { catalogue_id, name, company_name, email, mobile, city } = body

          if (!name || !email || !mobile) {
            return json({ error: 'Missing required fields' }, 400)
          }

          const res = await fetch(`${SUPABASE_URL}/rest/v1/catalogue_leads`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`
            },
            body: JSON.stringify({ catalogue_id, name, company_name, email, mobile, city })
          })

          if (!res.ok) {
            const err = await res.text()
            console.error('Supabase insert error', err)
            return json({ error: 'Database error' }, 500)
          }

          return json({ success: true })
        } catch (err) {
          return json({ error: err.message }, 500)
        }
      }

      const match = url.pathname.match(/^\/api\/catalogue\/files\/([^/]+)\/(view|download)$/)
      if (match && request.method === 'GET') {
        const fileId = match[1]
        const action = match[2]

        try {
          // Get file metadata from Supabase
          const res = await fetch(`${SUPABASE_URL}/rest/v1/catalogue_files?id=eq.${fileId}&select=*`, {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`
            }
          })

          const files = await res.json()
          if (!files || files.length === 0) {
            return json({ error: 'File not found' }, 404)
          }
          
          const file = files[0]
          if (!file.active) {
            return json({ error: 'File is not active' }, 403)
          }

          // Generate presigned URL
          const aws = new AwsClient({
            accessKeyId: AWS_ACCESS_KEY_ID,
            secretAccessKey: AWS_SECRET_ACCESS_KEY,
            region: AWS_REGION || 'us-east-1',
            service: 's3'
          })

          const encodedKey = encodeURIComponent(file.s3_key).replace(/%2F/g, '/');
          const s3Url = new URL(`https://${S3_BUCKET_NAME}.s3.${AWS_REGION || 'us-east-1'}.amazonaws.com/${encodedKey}`)
          
          // 10 minutes expiry
          s3Url.searchParams.set('X-Amz-Expires', '600')

          if (action === 'download') {
            s3Url.searchParams.set('response-content-disposition', `attachment; filename="${encodeURIComponent(file.name)}.pdf"`)
          } else {
            s3Url.searchParams.set('response-content-disposition', 'inline')
            s3Url.searchParams.set('response-content-type', 'application/pdf')
          }
          
          const presigned = await aws.sign(s3Url, {
            method: 'GET',
            aws: { signQuery: true }
          })

          return json({ url: presigned.url })
        } catch (err) {
          console.error(err)
          return json({ error: err.message }, 500)
        }
      }
      
      return json({ error: 'Not found' }, 404)
    }

    // Fall back to Vite assets for Cloudflare Pages
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request)
      if (response.status === 404 && request.method === 'GET') {
        const accept = request.headers.get('Accept')
        if (accept && accept.includes('text/html')) {
          const url = new URL(request.url)
          url.pathname = '/index.html'
          return env.ASSETS.fetch(new Request(url, request))
        }
      }
      return response
    }
    return new Response('Not found', { status: 404 })
  }
}
