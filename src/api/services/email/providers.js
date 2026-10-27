import { HTTPException } from 'hono/http-exception'

// Which mail provider a connected mailbox uses, and what Dikho can do with
// it (docs/decisions/0010-email-hub-providers.md).
//
// Every mailbox row names its provider explicitly. It is never inferred from
// the address: an @dikho.in address may live at Google Workspace or at
// Hostinger. Rows written before the provider column was exposed are Google.
//
// A capability is on only when the provider supports it AND Dikho implements
// it. Anything else is refused with the reason, so the dashboard can disable
// the control and say why, instead of a request that pretends to work.

export const PROVIDERS = ['google', 'hostinger']

export const FEATURES = [
  'read', // open conversations and messages
  'search', // search the provider beyond the cached list
  'send', // new messages
  'reply', // reply and reply all
  'forward',
  'drafts', // saved drafts at the provider
  'labels', // the mailbox's own labels
  'star',
  'mark_read',
  'archive',
  'attachments', // download received attachments
  'send_as', // send from an alias the provider has verified
  'push', // the provider tells Dikho about new mail
  'quota', // storage usage
]

const NOT_YET = 'Not available for Hostinger mailboxes yet.'

// Reasons for what each provider cannot do. A feature not listed here is
// supported and built.
const UNSUPPORTED = {
  google: {
    quota: 'Gmail does not report mailbox storage through its API.',
  },
  hostinger: {
    search: 'Search covers the conversations Dikho has synced. Searching older Hostinger mail is not available yet.',
    drafts: 'Hostinger\'s Mail API cannot save drafts. Write the message and send it, or use Hostinger Webmail for drafts.',
    labels: 'Hostinger mailboxes have folders, not labels.',
    archive: NOT_YET,
    send_as: 'Hostinger sends only as the mailbox address itself.',
    push: 'New Hostinger mail appears when the Email Hub syncs (on use, or with "Sync now").',
  },
}

/** The provider of a mailbox row. Rows from before the column was exposed are Google. */
export function providerOf(account) {
  const p = account?.provider ?? 'google'
  return PROVIDERS.includes(p) ? p : null
}

/** { read: true, drafts: false, ... } plus the reason for each false one. */
export function capabilitiesOf(account) {
  const provider = providerOf(account)
  const missing = provider ? UNSUPPORTED[provider] : null
  const capabilities = {}
  const reasons = {}
  for (const f of FEATURES) {
    const reason = missing ? missing[f] : 'This mailbox uses an unknown provider.'
    capabilities[f] = !reason
    if (reason) reasons[f] = reason
  }
  return { capabilities, unsupported: reasons }
}

export function can(account, feature) {
  return capabilitiesOf(account).capabilities[feature] === true
}

/** Refuses the request with the reason when the mailbox cannot do this. */
export function requireCapability(account, feature) {
  const { capabilities, unsupported } = capabilitiesOf(account)
  if (!capabilities[feature]) throw new HTTPException(409, { message: unsupported[feature] ?? 'This mailbox cannot do that.' })
}

export function requireProvider(account, provider) {
  if (providerOf(account) !== provider) {
    throw new HTTPException(409, { message: provider === 'google' ? 'This is not a Google mailbox.' : 'This is not a Hostinger mailbox.' })
  }
}
