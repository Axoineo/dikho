// Meta's send failure codes, in plain words, for the analytics breakdown. Only the
// codes this business meets in practice; anything else shows Meta's own message.
// Source: Meta's Cloud API error code reference.
export const FAILURE_REASONS = {
  131049: 'Held back by Meta to protect engagement (marketing limit per person)',
  131026: 'Not on WhatsApp, or cannot receive this message',
  131047: 'More than 24 hours since they last wrote: needs a template',
  131048: 'Rate limited for spam reports on earlier messages',
  131050: 'They stopped marketing messages from this business',
  131051: 'Message type not supported',
  131052: 'Media could not be downloaded from the sender',
  131053: 'Media could not be uploaded',
  131056: 'Too many messages to the same person too quickly',
  131021: 'Sent to the business’s own number',
  131031: 'WhatsApp Business account locked',
  131042: 'Payment problem on the WhatsApp Business account',
  131000: 'Something went wrong at Meta',
  130472: 'Held back by a Meta experiment',
  130497: 'Business may not message this country',
  132000: 'Template variables did not match',
  132001: 'Template does not exist in that language',
  132005: 'Template text too long after filling in',
  132007: 'Template content broke a policy',
  132012: 'Template header or variable in the wrong format',
  132015: 'Template paused for low quality',
  132016: 'Template disabled for low quality',
  133010: 'Phone number not registered',
  368: 'Temporarily blocked for policy violations',
  470: 'More than 24 hours since they last wrote',
  190: 'Access token expired or revoked',
}

/** The plain sentence for a failure, or Meta's own message, or the bare code. */
export function failureReason(code, metaMessage) {
  const key = String(code ?? '').trim()
  if (FAILURE_REASONS[key]) return FAILURE_REASONS[key]
  const message = String(metaMessage ?? '').trim()
  if (message) return message.slice(0, 160)
  return key ? `Error ${key}` : 'Error without a code'
}
