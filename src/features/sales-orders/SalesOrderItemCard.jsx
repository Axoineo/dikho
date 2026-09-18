import { formatValue, formatMoney, formatDate, getValue } from '../../lib/format'
import { gstBreakdown } from '../../lib/gst'
import { Icon } from '../../components/Icon'

export default function SalesOrderItemCard({ row }) {
  const breakdown = gstBreakdown(row)
  const references = [
    row.purchase_order_id ? `PO #${row.purchase_order_id}` : null,
    row.inv_number || (row.inv_id ? `Invoice #${row.inv_id}` : null),
  ].filter(Boolean).join(' · ')

  return (
    <div className="so-detail-item">
      <div className="so-detail-item-head">
        {row.document_color && <span className="so-color-dot" style={{ background: row.document_color }} aria-hidden="true" />}
        <span className="so-detail-item-name" title={row.name || ''}>{formatValue(row.name)}</span>
        <span className="so-detail-item-total">{formatMoney(row.after_tax_amount)}</span>
      </div>

      <div className="so-detail-item-meta">
        <span>{formatValue(getValue(row, ['type', 'label', 'reference_type']))}</span>
        {row.date && <span>{formatDate(row.date)}</span>}
        {row.invoice_number && <span>Inv {row.invoice_number}</span>}
        {row.self_audit_completed && <span className="so-detail-item-flag">Self-audited</span>}
      </div>

      <div className="so-detail-item-money">
        <span>Taxable <strong>{formatMoney(row.taxable_amount)}</strong></span>
        <span>Tax <strong>{formatMoney(row.tax_amount)}</strong></span>
      </div>

      {(breakdown || row.gst_type) && (
        <div className="so-detail-item-gst">{[row.is_taxable === false ? 'Not taxable' : row.gst_type, breakdown].filter(Boolean).join(' · ')}</div>
      )}

      {references && <div className="so-detail-item-gst">{references}</div>}

      {(row.document_courier || row.courier_status) && (
        <div className="so-detail-item-gst">{[row.document_courier, row.courier_status].filter(Boolean).join(' · ')}</div>
      )}

      {row.document_note && <div className="so-detail-item-note">{row.document_note}</div>}

      {row.file_url && (
        <a className="so-detail-item-link" href={row.file_url} target="_blank" rel="noopener noreferrer">
          <Icon name="file" size={14} /> Open attachment
        </a>
      )}
    </div>
  )
}
