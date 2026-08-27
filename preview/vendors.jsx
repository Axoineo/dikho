// Throwaway harness: renders VendorsPage against a stubbed PostgREST so the
// redesign can be checked in the browser without a Supabase session.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'

const MEDIA = [{ id: 1, name: 'Hoarding' }, { id: 2, name: 'Digital' }, { id: 3, name: 'Transit' }]
const SUB_MEDIA = [
  { id: 10, name: 'Banner', media_id: 1 }, { id: 11, name: 'Unipole', media_id: 1 },
  { id: 12, name: 'LED Wall', media_id: 2 }, { id: 13, name: 'Bus Shelter', media_id: 3 },
]
const PLACES = [
  { country: 'India', state: 'Gujarat', city: 'Ahmedabad' },
  { country: 'India', state: 'Gujarat', city: 'Surat' },
  { country: 'India', state: 'Maharashtra', city: 'Mumbai' },
  { country: 'India', state: 'Karnataka', city: 'Bengaluru' },
  { country: 'United Arab Emirates', state: 'Dubai', city: 'Dubai' },
]

const VENDORS = Array.from({ length: 38 }, (_, index) => {
  const place = PLACES[index % PLACES.length]
  const media = MEDIA[index % MEDIA.length]
  const sub = SUB_MEDIA.filter((item) => item.media_id === media.id)[index % 2] || SUB_MEDIA[0]
  return {
    id: 1000 + index,
    company_name: `${['Skyline', 'Metro', 'Prime', 'Vista', 'Orbit'][index % 5]} Media ${index + 1} Advertising Pvt Ltd`,
    alias: `${['Skyline', 'Metro', 'Prime', 'Vista', 'Orbit'][index % 5]}-${index + 1}`,
    contact_person: 'Ravi Kulkarni',
    country_dialcode: '+91',
    contact: 9820000000 + index,
    email: `accounts${index + 1}@skylinemedia.example.com`,
    gstin: `24AAACS${1000 + index}Q1Z${index % 10}`,
    pan_number: `AAACS${1000 + index}Q`,
    media_id: media.id,
    sub_media_id: sub.id,
    status: index % 4 === 0 ? 0 : 1,
    vendor_addresses: [{ ...place, address: `${index + 1} Ring Road`, zipcode: '380009', is_default: true }],
  }
})

function respond(body, { start = 0, end = 0, total = 0 } = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-range': `${start}-${end}/${total}` },
  })
}

// Enough of PostgREST's query grammar to make the filters observably real.
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const table = url.pathname.split('/').pop()
  const range = (new Headers(init.headers || {}).get('range') || '0-999').split('-').map(Number)
  console.log('[stub]', table, url.search, range.join('-'))

  if (table === 'media') return respond(MEDIA)
  if (table === 'sub_media') return respond(SUB_MEDIA)

  if (table === 'vendor_addresses') {
    if (range[0] > 0) return respond([])
    return respond(PLACES.map(({ state, city, country }) => ({ state, city, country })))
  }

  if (table === 'vendors') {
    let rows = VENDORS
    const eq = (param, read) => {
      const value = url.searchParams.get(param)
      if (value?.startsWith('eq.')) rows = rows.filter((row) => String(read(row)) === value.slice(3))
    }
    eq('media_id', (row) => row.media_id)
    eq('sub_media_id', (row) => row.sub_media_id)
    eq('status', (row) => row.status)
    eq('vendor_addresses.country', (row) => row.vendor_addresses[0].country)
    eq('vendor_addresses.state', (row) => row.vendor_addresses[0].state)
    eq('vendor_addresses.city', (row) => row.vendor_addresses[0].city)

    const or = url.searchParams.get('or')
    if (or) {
      const needle = (or.match(/ilike\.%([^%]*)%/) || [])[1]?.toLowerCase() || ''
      rows = rows.filter((row) => ['company_name', 'alias', 'email', 'gstin', 'pan_number']
        .some((field) => String(row[field] || '').toLowerCase().includes(needle)))
    }

    const total = rows.length
    const page = rows.slice(range[0], range[1] + 1)
    return respond(page, { start: range[0], end: range[0] + page.length - 1, total })
  }

  return respond([])
}

const { __PreviewVendorsPage: VendorsPage } = await import('../src/App.jsx')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="workspace"><VendorsPage /></div>
  </StrictMode>,
)
