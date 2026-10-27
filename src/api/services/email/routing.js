// Where the public DNS sends a domain's incoming mail (its MX records), read
// through DNS over HTTPS. Read-only: Dikho never changes DNS.
//
// Connecting a mailbox through an API proves Dikho can read and send with
// it; it says nothing about whether mail sent TO the address arrives there.
// That depends on the domain's MX records. dikho.in, for example, can have
// mailboxes at both Google Workspace and Hostinger, but its MX points at one
// of them; a mailbox at the other receives outside mail only if the first
// forwards it (Google Workspace "split delivery"), which DNS cannot show.

const DOH = 'https://cloudflare-dns.com/dns-query'
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const HOST = /^[a-z0-9.-]{1,253}$/

export function classifyMx(host) {
  if (/(^|\.)(google\.com|googlemail\.com)$/.test(host)) return 'google'
  if (/(^|\.)hostinger\.com$/.test(host)) return 'hostinger'
  return 'other'
}

/** { domain, mx: [{ preference, host }], routes_to: google|hostinger|other|mixed|none|unknown } */
export async function mailRouting(address) {
  const domain = String(address ?? '').split('@')[1]?.toLowerCase() ?? ''
  if (!DOMAIN.test(domain)) return { domain: null, mx: [], routes_to: 'unknown' }
  let data
  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    })
    data = res.ok ? await res.json() : null
  } catch {
    data = null
  }
  // 0 = answer, 3 = the name does not exist; anything else is a lookup failure.
  if (!data || ![0, 3].includes(data.Status)) return { domain, mx: [], routes_to: 'unknown' }
  const mx = (Array.isArray(data.Answer) ? data.Answer : [])
    .filter((a) => a?.type === 15 && typeof a.data === 'string')
    .map((a) => {
      const [pref, host = ''] = a.data.trim().split(/\s+/)
      return { preference: Number(pref), host: host.replace(/\.$/, '').toLowerCase() }
    })
    .filter((r) => Number.isInteger(r.preference) && r.preference >= 0 && HOST.test(r.host) && r.host !== '')
    .sort((a, b) => a.preference - b.preference)
    .slice(0, 10)
  if (!mx.length) return { domain, mx, routes_to: 'none' }
  const kinds = [...new Set(mx.map((r) => classifyMx(r.host)))]
  return { domain, mx, routes_to: kinds.length === 1 ? kinds[0] : 'mixed' }
}

/** Whether outside mail reaches a mailbox of `provider` directly, with a plain explanation. */
export function inboundStatus(provider, routing) {
  const name = provider === 'hostinger' ? 'Hostinger' : 'Google Workspace'
  const other = provider === 'hostinger' ? 'Google Workspace' : 'Hostinger'
  switch (routing.routes_to) {
    case 'unknown':
      return { inbound: 'unknown', note: 'The domain\'s mail routing could not be checked just now.' }
    case 'none':
      return { inbound: 'none', note: `${routing.domain} has no MX records, so it cannot receive email at all.` }
    case provider:
      return { inbound: 'direct', note: `Incoming mail for ${routing.domain} is delivered to ${name}.` }
    case 'google':
    case 'hostinger':
      return {
        inbound: 'elsewhere',
        note: `Incoming mail for ${routing.domain} is delivered to ${other}, not ${name}. This mailbox receives outside mail only if ${other} forwards it to ${name} (split delivery). Sending works regardless. See the setup guide before changing anything.`,
      }
    default:
      return { inbound: 'elsewhere', note: `Incoming mail for ${routing.domain} goes to another provider. Check the domain's MX records before relying on this mailbox for incoming mail.` }
  }
}
