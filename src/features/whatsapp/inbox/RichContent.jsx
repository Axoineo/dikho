// Bubbles for messages that are more than text or a file. The payload comes
// from messages.payload (see src/api/services/whatsapp/richContent.js); the
// plain `body` is only a summary and is not shown when one of these renders.
//
// Every text section is a relative box with 5px bottom padding, so the clock
// placed in it (MessageBubble's `meta`, at bottom-[4px]) shares the baseline
// of its last line, the same rule the plain text bubble follows.


function Icon({ d, className = '' }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>{d}</svg>
  )
}

const ICON = {
  pin: <><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  reply: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
  link: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  cart: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3h3l2.6 12.5h11l2-8.5H6.4" /></>,
}

// Text block that carries the clock on its last line. `spacer` goes inside
// the last paragraph by the caller, so the clock shares that line.
function TextSection({ children, meta, className = '' }) {
  return (
    <div className={`relative py-[5px] pl-[9px] pr-[7px] ${className}`}>
      {children}
      {meta}
    </div>
  )
}

// Under a card with no text of its own, the clock gets a slim strip.
function MetaStrip({ meta }) {
  return <div className="relative h-[20px]">{meta}</div>
}

// The rows WhatsApp draws under a message: reply buttons, a list's button, a
// link, a request. Inert here: they are what the customer taps.
function ActionRows({ rows }) {
  if (!rows.length) return null
  return (
    <div className="mt-[2px]">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center justify-center gap-1.5 border-t border-chat-ring px-3 py-[9px] text-[14px] font-medium text-chat-action">
          {row.icon && <Icon d={row.icon} />}
          <span className="truncate">{row.label}</span>
        </div>
      ))}
    </div>
  )
}

function mapsUrl(p) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.latitude},${p.longitude}`)}`
}

function LocationCard({ payload }) {
  const hasPoint = Number.isFinite(payload.latitude) && Number.isFinite(payload.longitude)
  const inner = (
    <span className="flex items-start gap-2.5 rounded-[6px] bg-chat-quote px-3 py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-chat-raised text-chat-action"><Icon d={ICON.pin} className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium">{payload.name || 'Location'}</span>
        {payload.address && <span className="line-clamp-2 block text-[12.5px] text-chat-secondary">{payload.address}</span>}
        {hasPoint && <span className="mt-0.5 block text-[12px] tabular-nums text-chat-secondary">{payload.latitude.toFixed(5)}, {payload.longitude.toFixed(5)}</span>}
      </span>
    </span>
  )
  return hasPoint
    ? <a href={mapsUrl(payload)} target="_blank" rel="noopener noreferrer" className="block w-64 max-w-full text-inherit no-underline hover:brightness-95" title="Open in Google Maps">{inner}</a>
    : <span className="block w-64 max-w-full">{inner}</span>
}

function ContactCards({ payload }) {
  return (
    <div className="flex w-64 max-w-full flex-col gap-[3px]">
      {(payload.contacts ?? []).map((c, i) => (
        <div key={i} className="flex items-start gap-2.5 rounded-[6px] bg-chat-quote px-3 py-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-chat-raised text-chat-secondary"><Icon d={ICON.person} className="h-[18px] w-[18px]" /></span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium">{c.name || 'Contact'}</span>
            {c.org && <span className="block truncate text-[12.5px] text-chat-secondary">{c.org}</span>}
            {(c.phones ?? []).map((p, j) => <span key={j} className="block select-all text-[12.5px] tabular-nums text-chat-secondary">{p.phone}</span>)}
            {(c.emails ?? []).map((e, j) => <span key={j} className="block truncate select-all text-[12.5px] text-chat-secondary">{e}</span>)}
          </span>
        </div>
      ))}
    </div>
  )
}

const ADDRESS_LABELS = [
  ['name', 'Name'], ['phone_number', 'Phone'], ['house_number', 'House'], ['floor_number', 'Floor'],
  ['tower_number', 'Tower'], ['building_name', 'Building'], ['address', 'Address'], ['landmark_area', 'Landmark'],
  ['city', 'City'], ['state', 'State'], ['in_pin_code', 'PIN code'],
]

function FormReply({ payload, renderText, spacer }) {
  const values = payload.values ?? {}
  const rows = payload.name === 'address_message'
    ? ADDRESS_LABELS.filter(([k]) => values[k]).map(([k, label]) => [label, values[k]])
    : Object.entries(values).map(([k, v]) => [k, String(v)])
  return (
    <>
      {payload.name === 'address_message' && (
        <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-chat-action"><Icon d={ICON.home} /> Delivery address</div>
      )}
      {rows.map(([label, value], i) => (
        <div key={label} className="text-[13.5px] leading-[19px]">
          <span className="text-chat-secondary">{label}: </span>{renderText(value)}{i === rows.length - 1 && spacer}
        </div>
      ))}
      {rows.length === 0 && <div className="text-[13.5px] text-chat-secondary">Form submitted{spacer}</div>}
    </>
  )
}

function interactiveRows(p) {
  switch (p.interactive_type) {
    case 'buttons': return (p.buttons ?? []).map((label) => ({ label, icon: ICON.reply }))
    case 'list': return [{ label: p.button, icon: ICON.list }]
    case 'cta_url': return [{ label: p.label, icon: ICON.link }]
    case 'location_request': return [{ label: 'Send location', icon: ICON.pin }]
    case 'address': return [{ label: 'Send address', icon: ICON.home }]
    default: return []
  }
}

// Header, body and footer, as WhatsApp lays out interactive and template
// messages.
function Composed({ header, body, footer, renderText, spacer }) {
  return (
    <>
      {header && <p className="m-0 mb-0.5 font-semibold">{renderText(header)}</p>}
      <p className="m-0 whitespace-pre-wrap break-words">{renderText(body)}{!footer && spacer}</p>
      {footer && <p className="m-0 mt-0.5 text-[12.5px] text-chat-secondary">{renderText(footer)}{spacer}</p>}
    </>
  )
}

// `renderMeta('text')` is the clock for a text line, `renderMeta('strip')`
// the one for a strip under a card (MessageBubble builds both).
export function RichBody({ payload, renderMeta, spacer, renderText }) {
  const meta = renderMeta('text')
  switch (payload.kind) {
    case 'location':
      return (
        <>
          <div className="p-[3px] pb-0"><LocationCard payload={payload} /></div>
          <MetaStrip meta={renderMeta('strip')} />
        </>
      )
    case 'contacts':
      return (
        <>
          <div className="p-[3px] pb-0"><ContactCards payload={payload} /></div>
          <MetaStrip meta={renderMeta('strip')} />
        </>
      )
    case 'interactive':
      return (
        <>
          <TextSection meta={meta}>
            <Composed header={payload.header} body={payload.body} footer={payload.footer} renderText={renderText} spacer={spacer} />
          </TextSection>
          {payload.interactive_type === 'list' && payload.sections?.length > 0 && (
            <ul className="m-0 list-none border-t border-chat-ring px-[9px] py-1.5 text-[12.5px] text-chat-secondary">
              {payload.sections.flatMap((s) => s.rows).map((r, i) => (
                <li key={i} className="truncate py-[1px]">• {r.title}{r.description ? ` · ${r.description}` : ''}</li>
              ))}
            </ul>
          )}
          {payload.interactive_type === 'cta_url' && payload.url && (
            <a href={payload.url} target="_blank" rel="noopener noreferrer" className="block truncate border-t border-chat-ring px-[9px] py-1 text-[12px] text-chat-secondary no-underline hover:underline">{payload.url}</a>
          )}
          <ActionRows rows={interactiveRows(payload)} />
        </>
      )
    case 'template':
      return (
        <>
          <TextSection meta={meta}>
            <span className="mb-0.5 block text-[11.5px] font-medium uppercase tracking-[.3px] text-chat-secondary">Template · {payload.name}</span>
            <Composed header={payload.header} body={payload.body} footer={payload.footer} renderText={renderText} spacer={spacer} />
          </TextSection>
          <ActionRows rows={(payload.buttons ?? []).map((label) => ({ label }))} />
        </>
      )
    case 'form_reply':
      return (
        <TextSection meta={meta}>
          <FormReply payload={payload} renderText={renderText} spacer={spacer} />
        </TextSection>
      )
    case 'order':
      return (
        <TextSection meta={meta}>
          <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-chat-action"><Icon d={ICON.cart} /> Order · {payload.items?.length ?? 0} items</div>
          {(payload.items ?? []).map((item, i) => (
            <div key={i} className="text-[13.5px] tabular-nums">{item.quantity} × {item.product}{item.price !== undefined ? ` · ${item.currency ?? ''} ${item.price}` : ''}</div>
          ))}
          <p className="m-0 mt-1 text-[13.5px]">{payload.text ? renderText(payload.text) : null}{spacer}</p>
        </TextSection>
      )
    default:
      return null
  }
}

// Shown above the content of the first message from a click-to-WhatsApp ad.
export function ReferralBanner({ referral }) {
  return (
    <div className="rounded-[6px] bg-chat-quote px-2.5 py-1.5">
      <span className="block text-[11.5px] font-semibold uppercase tracking-[.3px] text-chat-quote-them">From an ad</span>
      {referral.headline && <span className="block text-[13.5px] font-medium">{referral.headline}</span>}
      {referral.body && <span className="line-clamp-2 block text-[12.5px] text-chat-secondary">{referral.body}</span>}
      {referral.source_url && (
        <a href={referral.source_url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-chat-action no-underline hover:underline">View ad</a>
      )}
    </div>
  )
}
