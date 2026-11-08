// Meta errors that should stop a whole campaign, not just fail one message.
//
// The first campaign kept sending through Meta's warnings. These codes mean the
// number or account is being restricted, the template can no longer go out, or
// the credentials are broken: every further message would fail too, and for
// the spam limits each one makes the number's standing worse. Per-person
// failures (not on WhatsApp, 131049 marketing limit per person, opted out of
// marketing) are NOT here; they are normal on any list and only skip that person.
//
// `resumable` is true when waiting is the fix (rate limits, outages); false
// when someone has to act first (spam quality, account, template, token).

const HALTS = {
  131048: { resumable: false, reason: 'Meta is limiting this number because too many earlier messages were blocked or reported as spam. Do not send more today; check the number\'s quality rating in WhatsApp Manager.' },
  131031: { resumable: false, reason: 'Meta has locked the WhatsApp Business account. Check WhatsApp Manager.' },
  368: { resumable: false, reason: 'Meta has temporarily blocked the account for a policy violation. Check WhatsApp Manager.' },
  131042: { resumable: false, reason: 'Meta reports a payment problem on the WhatsApp Business account.' },
  130497: { resumable: false, reason: 'The account is not allowed to message people in this country.' },
  132015: { resumable: false, reason: 'Meta paused this template because people rated it poorly. Check it in WhatsApp Manager.' },
  132016: { resumable: false, reason: 'Meta disabled this template because people rated it poorly.' },
  132000: { resumable: false, reason: 'The values sent do not match the approved template.' },
  132012: { resumable: false, reason: 'The values sent do not match the approved template\'s format.' },
  132001: { resumable: false, reason: 'This template does not exist in this language on Meta.' },
  132005: { resumable: false, reason: 'The filled-in template is longer than WhatsApp allows.' },
  132007: { resumable: false, reason: 'The filled-in template breaks WhatsApp\'s formatting rules.' },
  190: { resumable: false, reason: 'The WhatsApp access token has expired or is not valid.' },
  10: { resumable: false, reason: 'The WhatsApp app does not have permission to send.' },
  200: { resumable: false, reason: 'The WhatsApp app does not have permission to send.' },
  130429: { resumable: true, reason: 'Meta\'s sending rate limit was reached. Wait a few minutes, then resume.' },
  80007: { resumable: true, reason: 'Meta\'s rate limit for this account was reached. Wait a while, then resume.' },
  4: { resumable: true, reason: 'Meta\'s app rate limit was reached. Wait a while, then resume.' },
  131016: { resumable: true, reason: 'WhatsApp is temporarily unavailable. Try again later.' },
}

// The ones Meta may report later, by webhook, rather than on the send itself.
// A batch looks for these on the campaign before it sends anything.
export const WATCHED_CODES = ['131048', '131031', '368', '131042', '130497', '132015', '132016']

export function haltFor(code) {
  const halt = HALTS[String(code ?? '')]
  return halt ? { code: String(code), ...halt } : null
}

// When most of a batch failed for reasons not listed above, something is wrong
// that a person should look at before the rest of the list is spent on it.
export function mostlyFailed(outcomes) {
  const attempted = outcomes.length
  const failed = outcomes.filter(({ result }) => !result.ok)
  if (attempted < 10 || failed.length / attempted < 0.6) return null
  return {
    code: 'mostly_failed',
    resumable: true,
    reason: `${failed.length} of ${attempted} messages in the last batch failed (first error: ${failed[0].result.errorMessage}). Check what went wrong before sending the rest.`,
  }
}
