import { TOKEN_RE, resolveValue } from '../../lib/templateVars'

// Renders the approved template the way the recipient will see it.
// Colours here are WhatsApp's own (wa-* in tailwind.config.js), not the
// dashboard tokens — it is a mockup of their client, so it should not follow
// this app's light/dark theme.
//
// When a variableMap + sampleContact are supplied, {{tokens}} are substituted
// with that recipient's values (highlighted green); tokens with no value stay
// as the literal {{token}} in amber so personalization gaps are obvious.
function renderRich(text, variableMap, sampleContact) {
  if (!text) return null
  if (!variableMap || !sampleContact) return text

  const parts = []
  const regex = new RegExp(TOKEN_RE.source, 'g')
  let last = 0
  let match
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[1].trim()
    const value = resolveValue(token, variableMap, sampleContact)
    parts.push(
      value
        ? <span key={key++} className="rounded-[3px] bg-wa-tick/25 px-0.5 font-semibold">{value}</span>
        : <span key={key++} className="rounded-[3px] bg-amber-400/30 px-0.5">{match[0]}</span>,
    )
    last = regex.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// A doodle-ish chat backdrop drawn with gradients, so there is no image asset.
const CANVAS_TEXTURE = {
  backgroundImage: [
    'radial-gradient(circle at 18% 22%, rgba(255,255,255,0.022) 0 9px, transparent 9px)',
    'radial-gradient(circle at 76% 58%, rgba(255,255,255,0.022) 0 12px, transparent 12px)',
    'radial-gradient(circle at 42% 84%, rgba(255,255,255,0.018) 0 7px, transparent 7px)',
  ].join(','),
  backgroundSize: '130px 130px',
}

function DoubleTick() {
  return (
    <svg width="15" height="11" viewBox="0 0 16 11" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-wa-tick">
      <path d="M1 5.5 4 8.5 9.5 2" />
      <path d="M6 8.2 6.8 9 12.3 2.5" />
    </svg>
  )
}

export function WhatsAppPreview({ template, businessName = 'Dikho', variableMap, sampleContact }) {
  const shell = 'w-[300px] max-w-full overflow-hidden rounded-[26px] border border-line bg-wa-canvas shadow-2xl'

  if (!template) {
    return (
      <div className={shell}>
        <div className="grid min-h-[250px] place-items-center px-5 py-10 text-center text-[13px] text-muted">
          Select a template to see the preview
        </div>
      </div>
    )
  }

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={shell}>
      <div className="flex items-center gap-2.5 bg-wa-bar px-3 py-2.5 text-wa-text">
        <div className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#6b7c85] text-xs font-bold">
          {businessName.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="text-[13px] font-semibold leading-tight">{businessName}</div>
          <div className="text-[10.5px] text-wa-sub">Business account</div>
        </div>
      </div>

      <div className="flex min-h-[250px] flex-col gap-2 bg-wa-canvas px-3 pb-5 pt-4" style={CANVAS_TEXTURE}>
        <div className="relative max-w-[85%] self-end rounded-lg rounded-tr-[2px] bg-wa-bubble
          px-2.5 pb-1.5 pt-[7px] text-[13px] leading-[1.45] text-wa-text shadow-sm">
          {template.headerText && (
            <div className="mb-[3px] font-bold">{renderRich(template.headerText, variableMap, sampleContact)}</div>
          )}

          <div className="whitespace-pre-wrap break-words">
            {renderRich(template.bodyText, variableMap, sampleContact)}
          </div>

          {template.footerText && (
            <div className="mt-[5px] text-[11px] text-wa-text/55">{template.footerText}</div>
          )}

          <div className="mt-0.5 flex items-center justify-end gap-[3px] text-[10.5px] text-wa-text/60">
            {now} <DoubleTick />
          </div>

          {template.buttons?.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-px">
              {template.buttons.map((button) => (
                <div key={button.text}
                  className="border-t border-white/10 bg-wa-bubble py-[7px] text-center text-[12.5px] font-medium text-wa-tick">
                  {button.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
