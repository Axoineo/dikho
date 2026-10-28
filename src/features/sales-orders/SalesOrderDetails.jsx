import { formatDisplayDate, formatDateRange, formatRupees } from '../../lib/format'
import { toAmount, round2 } from '../../lib/money'
import { campaignDays } from '../../lib/dates'
import { storedItemTotals, MONEY_EPSILON } from '../../lib/gst'
import { statusTone } from '../../lib/status'
import { Icon } from '../../components/Icon'
import { DetailsPanel, Section, KeyValues, StatusPill } from '../../components/crm/CrmUi'
import SalesOrderItemCard from './SalesOrderItemCard'

export default function SalesOrderDetails({ order, items, itemsLoading, itemsError, onClose, onEdit, onDownloadInvoice }) {
  if (!order) return null

  const duration = campaignDays(order.campaign_start_date, order.campaign_end_date)

  // The parent carries its own totals, so a parent whose stored figures have
  // drifted from its items (edited elsewhere, a partial write) is worth saying
  // out loud rather than showing two numbers and leaving the reader to spot it.
  const stored = storedItemTotals(items)
  const drifted = !itemsLoading && !itemsError && items.length > 0
    && Math.abs(stored.total - toAmount(order.total)) > MONEY_EPSILON

  const received = order.payment_receipt_amount
  const balance = received == null ? null : round2(toAmount(order.total) - toAmount(received))

  return (
    <DetailsPanel
      label="Sales order details"
      title={order.order_number || `Order #${order.id}`}
      meta={<>
        {order.order_status && <StatusPill tone={statusTone(order.order_status)}>{order.order_status}</StatusPill>}
        <span>{order.company || 'No client'}</span>
      </>}
      onClose={onClose}
      actions={<>
        {onDownloadInvoice && (
          <button type="button" className="crm-btn crm-btn--secondary crm-btn--sm" onClick={onDownloadInvoice} title="Download the tax invoice PDF">
            <Icon name="invoice" size={15} /> Invoice
          </button>
        )}
        {onEdit && (
          <button type="button" className="crm-btn crm-btn--secondary crm-btn--sm" onClick={onEdit}>
            <Icon name="edit" size={15} /> Edit
          </button>
        )}
      </>}
    >
      <div className="crm-figures">
        <div className="crm-figures-total"><span>Total</span><strong className="crm-mono">{formatRupees(order.total)}</strong></div>
        <div className="crm-figures-row"><span>Before tax</span><strong className="crm-mono">{formatRupees(order.sub_total)}</strong></div>
        <div className="crm-figures-row"><span>Tax</span><strong className="crm-mono">{formatRupees(order.tax_total)}</strong></div>
        {received != null && <div className="crm-figures-row"><span>Received</span><strong className="crm-mono">{formatRupees(received)}</strong></div>}
        {balance != null && <div className="crm-figures-row is-balance"><span>Balance due</span><strong className="crm-mono">{formatRupees(balance)}</strong></div>}
      </div>

      {drifted && (
        <div className="crm-note" role="status">
          <Icon name="alert" size={16} />
          <div>The items add up to {formatRupees(stored.total)}, not the stored total. Opening and saving the order recalculates it.</div>
        </div>
      )}

      <Section title={`Items${!itemsLoading && !itemsError ? ` (${items.length})` : ''}`}>
        {itemsLoading ? (
          <p className="crm-section-note">Loading items…</p>
        ) : itemsError ? (
          <div className="crm-note crm-note--danger" role="alert">{itemsError}</div>
        ) : items.length === 0 ? (
          <p className="crm-section-note">This order has no items.</p>
        ) : (
          <div className="crm-lines">{items.map((row) => <SalesOrderItemCard key={row.id} row={row} />)}</div>
        )}
      </Section>

      <Section title="Order">
        <KeyValues items={[
          { label: 'Client', value: order.company, wide: true, keep: true },
          { label: 'Client contact', value: order.order_client_fullname },
          { label: 'Order type', value: order.order_type },
          { label: 'Order date', value: order.order_date && formatDisplayDate(order.order_date), keep: true },
          { label: 'Invoice date', value: order.invoice_date && formatDisplayDate(order.invoice_date) },
          { label: 'Purchase status', value: order.purchase_status },
          { label: 'CRM reference', value: order.crm_reference_id, mono: true },
          { label: 'Unique ID', value: order.unique_id, mono: true },
          { label: 'Multi-purpose SO', value: order.multi_purpose_so ? 'Yes' : null },
        ]} />
      </Section>

      <Section title="Campaign">
        <KeyValues items={[
          { label: 'Dates', value: formatDateRange(order.campaign_start_date, order.campaign_end_date), keep: true },
          { label: 'Duration', value: duration && `${duration} ${duration === 1 ? 'day' : 'days'}` },
          { label: 'Brand', value: order.brand_name },
          { label: 'Invoice courier', value: order.invoice_courier },
        ]} />
      </Section>

      <Section title="History">
        <KeyValues items={[
          { label: 'Approved by', value: order.approved_by },
          { label: 'Approved on', value: order.approved_date && formatDisplayDate(order.approved_date) },
          { label: 'Completed on', value: order.complete_date && formatDisplayDate(order.complete_date) },
          { label: 'Created by', value: order.created_by, wide: true },
          { label: 'Created on', value: order.created_at && formatDisplayDate(order.created_at) },
          { label: 'Last changed', value: order.updated_at && formatDisplayDate(order.updated_at) },
        ]} />
      </Section>
    </DetailsPanel>
  )
}
