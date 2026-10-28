import { formatDisplayDate, formatRupees } from '../../lib/format'
import { gstBreakdown } from '../../lib/gst'
import { Icon } from '../../components/Icon'

/**
 * One line of an order in a details panel. Shared by sales and purchase
 * orders; `forPurchaseOrder` drops the "PO #" link a PO line would only
 * point back at itself with.
 */
export default function SalesOrderItemCard({ row, forPurchaseOrder = false }) {
  const breakdown = gstBreakdown(row)
  const tax = row.is_taxable === false ? 'Not taxable' : [row.gst_type, breakdown].filter(Boolean).join(' · ')
  const meta = [
    row.type || row.label,
    row.date && formatDisplayDate(row.date),
    row.invoice_number && `Invoice ${row.invoice_number}`,
    !forPurchaseOrder && row.purchase_order_id && `PO #${row.purchase_order_id}`,
    row.inv_number,
    [row.document_courier, row.courier_status].filter(Boolean).join(', '),
    row.self_audit_completed && 'Self-audited',
  ].filter(Boolean)

  return (
    <div className="crm-line">
      <div className="crm-line-head">
        <span className="crm-line-name" title={row.name || ''}>
          {row.document_color && <span className="crm-swatch" style={{ background: row.document_color, marginRight: 8 }} aria-hidden="true" />}
          {row.name || 'Untitled item'}
        </span>
        <span className="crm-line-amount">{formatRupees(row.after_tax_amount)}</span>
      </div>
      <div className="crm-line-meta">
        <span>{formatRupees(row.taxable_amount)} + {formatRupees(row.tax_amount)} tax</span>
        {tax && <span>{tax}</span>}
      </div>
      {meta.length > 0 && <div className="crm-line-meta">{meta.map((part) => <span key={part}>{part}</span>)}</div>}
      {row.document_note && <div className="crm-line-note">{row.document_note}</div>}
      {/^https?:\/\//i.test(row.file_url || '') && (
        <a className="crm-line-link" href={row.file_url} target="_blank" rel="noopener noreferrer">
          <Icon name="link" size={14} /> Open attachment
        </a>
      )}
    </div>
  )
}
