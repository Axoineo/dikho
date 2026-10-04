// Documentation-only preview with synthetic catalog data. It never submits.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Same stylesheets, in the same order, as src/main.jsx, so the page renders
// here exactly as it does in the app.
import '../../src/index.css'
import '../../src/components/ContactDetails.css'
import '../../src/tailwind.css'

const MEDIA = [
  { id: 1, name: 'Outdoor' },
  { id: 2, name: 'Digital' },
  { id: 3, name: 'Print' },
]

const SUB_MEDIA = [
  { id: 10, name: 'Hoarding', media_id: 1 },
  { id: 11, name: 'Social media', media_id: 2 },
  { id: 12, name: 'Newspaper', media_id: 3 },
]

window.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const table = url.pathname.split('/').pop()
  const rows = table === 'media' ? MEDIA : table === 'sub_media' ? SUB_MEDIA : []
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0',
    },
  })
}

const { default: PublicVendorForm } = await import('../../src/features/public/PublicVendorForm.jsx')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PublicVendorForm />
  </StrictMode>,
)
