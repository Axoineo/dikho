import { formatValue, formatMoney, formatDate } from '../../lib/format'
import { toAmount, round2 } from '../../lib/money'
import { campaignDays } from '../../lib/dates'
import { storedItemTotals, MONEY_EPSILON } from '../../lib/gst'
import { statusTone } from '../../lib/status'
import { Icon } from '../../components/Icon'
import SalesOrderItemCard from './SalesOrderItemCard'

export default function SalesOrderDetails({ order, items, itemsLoading, itemsError, onClose, onEdit }) {
  if (!order) return null

  const duration = campaignDays(order.campaign_start_date, order.campaign_end_date)

  // The parent carries its own totals, so a parent whose stored figures have
  // drifted from its items (edited elsewhere, a partial write) is worth saying
  // out loud rather than showing two numbers and leaving the reader to spot it.
  const stored = storedItemTotals(items)
  const drifted = !itemsLoading && !itemsError && items.length > 0
    && Math.abs(stored.total - toAmount(order.total)) > MONEY_EPSILON

  const receipt = toAmount(order.payment_receipt_amount)
  const balance = order.payment_receipt_amount == null ? null : round2(toAmount(order.total) - receipt)

  const sections = [
    { title: 'Order Info', fields: [
      ['ID', order.id],
      ['Order Number', order.order_number],
      ['CRM Reference', order.crm_reference_id],
      ['Unique ID', order.unique_id],
      ['Order Type', order.order_type],
      ['Order Date', order.order_date && formatDate(order.order_date)],
      ['Invoice Date', order.invoice_date && formatDate(order.invoice_date)],
      ['Order Status', order.order_status],
      ['Purchase Status', order.purchase_status],
      ['Multi Purpose SO', order.multi_purpose_so == null ? null : (order.multi_purpose_so ? 'Yes' : 'No')],
    ]},
    { title: 'Client', fields: [
      ['Company', order.company],
      ['Client Contact', order.order_client_fullname],
    ]},
    { title: 'Campaign', fields: [
      ['Start Date', order.campaign_start_date && formatDate(order.campaign_start_date)],
      ['End Date', order.campaign_end_date && formatDate(order.campaign_end_date)],
      ['Duration', duration && `${duration} ${duration === 1 ? 'day' : 'days'}`],
    ]},
    { title: 'Media / Brand', fields: [
      ['Brand Name', order.brand_name],
      ['Invoice Courier', order.invoice_courier],
    ]},
    { title: 'Approval', fields: [
      ['Approved By', order.approved_by],
      ['Approved Date', order.approved_date && formatDate(order.approved_date)],
      ['Completed Date', order.complete_date && formatDate(order.complete_date)],
      ['Created By', order.created_by],
      ['Created At', order.created_at && formatDate(order.created_at)],
      ['Last Updated', order.updated_at && formatDate(order.updated_at)],
    ]},
  ]

  return (
    <aside className="details-drawer" aria-label="Sales order details">
      <div className="drawer-header">
        <div>
          <span className="drawer-kicker">SALES ORDER</span>
          <h2>{formatValue(order.order_number)}</h2>
        </div>
        <div className="drawer-header-actions">
          <button className="icon-button" onClick={onEdit} aria-label="Edit sales order" title="Edit">
            <Icon name="edit" size={18} />
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={19} />
          </button>
        </div>
      </div>
      <div className="drawer-divider" />

      {/* ── Financial totals ───────────────────────────────────────────── */}
      <div className="so-total-panel">
        <div className="so-total-row">
          <span>Sub Total</span>
          <span className="mono-cell">{formatMoney(order.sub_total)}</span>
        </div>
        <div className="so-total-row">
          <span>Tax Total</span>
          <span className="mono-cell">{formatMoney(order.tax_total)}</span>
        </div>
        <div className="so-total-row is-grand">
          <span>Total</span>
          <span className="mono-cell">{formatMoney(order.total)}</span>
        </div>
        {order.payment_receipt_amount != null && (
          <>
            <div className="so-total-row">
              <span>Payment Received</span>
              <span className="mono-cell">{formatMoney(receipt)}</span>
            </div>
            <div className="so-total-row">
              <span>Balance</span>
              <span className="mono-cell">{formatMoney(balance)}</span>
            </div>
          </>
        )}
      </div>

      {drifted && (
        <div className="so-drift-note" role="status">
          The items on this order add up to {formatMoney(stored.total)}, which differs from the stored total.
          Saving the order again will recalculate it.
        </div>
      )}

      {/* ── Child items ────────────────────────────────────────────────── */}
      <div className="details-list">
        <div className="details-section-title">
          Order Items
          {!itemsLoading && !itemsError && <span className="so-item-count">{items.length}</span>}
        </div>

        {itemsLoading ? (
          <div className="so-detail-items-state">Loading items…</div>
        ) : itemsError ? (
          <div className="so-detail-items-state is-error">{itemsError}</div>
        ) : items.length === 0 ? (
          <div className="so-detail-items-state">No items recorded on this order yet.</div>
        ) : (
          <div className="so-detail-items">
            {items.map((row) => <SalesOrderItemCard key={row.id} row={row} />)}
          </div>
        )}

        {sections.map((section) => (
          <div key={section.title}>
            <div className="details-section-title">{section.title}</div>
            {section.fields.map(([label, value]) => (
              <div className="detail-row" key={label}>
                <span className="detail-label">{label}</span>
                <span className="detail-value">{formatValue(value)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}
