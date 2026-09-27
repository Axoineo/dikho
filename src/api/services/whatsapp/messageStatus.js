// Shared vocabulary for outbound message status receipts.
//
// Lives outside the webhook route because two callers need identical rules:
// the live webhook (src/api/routes/whatsapp/webhook.js) and the reconciler
// (./reconcile.js), which replays stored receipts. If the two ever disagreed,
// a replay could undo what the live path decided.

export const STATUS_COLUMN = {
  sent: 'sent_at',
  delivered: 'delivered_at',
  read: 'read_at',
  failed: 'failed_at',
}

// Never downgrade: a late "delivered" must not overwrite a "read" that already
// arrived, since Meta does not guarantee receipt ordering.
export const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 }

// Ranks the stored status inline so the comparison happens inside the same
// statement that applies the receipt. `column` is qualified by the caller
// because UPDATE ... FROM needs `m.status` rather than a bare `status`.
export const storedRankSql = (column = 'status') => `CASE ${column}
  WHEN 'pending' THEN 0
  WHEN 'sent' THEN 1
  WHEN 'delivered' THEN 2
  WHEN 'read' THEN 3
  WHEN 'failed' THEN 4
  ELSE 0 END`
