import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Icon } from '../../components/Icon'
import { PageHeader } from '../../components/crm/CrmUi'

const TEMPLATE_PATH = '/Temps/SO_template.pdf'

// One order's tax invoice PDF, on a page of its own. The Android app draws Sales
// orders natively and opens this for the invoice, which is drawn from the template
// here in the page; anyone can also open it from a link. RLS decides whether the
// order can be read, exactly as on the Sales orders page.
export default function SalesOrderInvoicePage() {
  const { id } = useParams()
  const [state, setState] = useState({ status: 'working', order: null, error: '' })
  const startedFor = useRef(null)

  const make = useCallback(async () => {
    if (!/^\d{1,18}$/.test(id || '')) {
      setState({ status: 'failed', order: null, error: 'This link does not name a sales order.' })
      return
    }
    setState((current) => ({ status: 'working', order: current.order, error: '' }))
    const { data, error } = await supabase
      .from('salesorder')
      .select('*')
      .eq('id', id)
      .is('vendor_address_id', null)
      .maybeSingle()
    if (error || !data) {
      setState({ status: 'failed', order: null, error: error?.message || 'This order was not found, or your access does not include it.' })
      return
    }
    try {
      // pdf-lib and fontkit load with the request, as on the Sales orders page.
      const { generateTaxInvoice } = await import('../invoices/generateTaxInvoice')
      await generateTaxInvoice(TEMPLATE_PATH, data)
      setState({ status: 'done', order: data, error: '' })
    } catch (err) {
      console.error('[TI Download]', err)
      setState({ status: 'failed', order: data, error: err.message })
    }
  }, [id])

  // Once per order: a second run (StrictMode, a re-render) would download it twice.
  useEffect(() => {
    if (startedFor.current === id) return
    startedFor.current = id
    make()
  }, [id, make])

  const name = state.order ? (state.order.order_number || `order #${state.order.id}`) : 'this order'

  return (
    <div className="crm-page">
      <PageHeader title="Tax invoice" subtitle={state.order?.company || 'Sales order'} />
      <section className="crm-card" style={{ padding: 20, display: 'grid', gap: 16, maxWidth: 560 }}>
        {state.status === 'working' && <p className="crm-section-note" role="status">Making the tax invoice for {name}…</p>}
        {state.status === 'done' && (
          <div className="crm-note" role="status">
            <Icon name="invoice" size={17} />
            <div>The tax invoice for {name} has been downloaded.</div>
          </div>
        )}
        {state.status === 'failed' && (
          <div className="crm-note crm-note--danger" role="alert">
            <Icon name="alert" size={17} />
            <div><strong>Could not make the tax invoice.</strong> {state.error}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {state.status !== 'working' && state.order && (
            <button type="button" className="crm-btn crm-btn--primary" onClick={make}>
              <Icon name="invoice" size={16} /> {state.status === 'done' ? 'Download again' : 'Try again'}
            </button>
          )}
          <Link to="/sales-orders" className="crm-btn crm-btn--secondary">Back to sales orders</Link>
        </div>
      </section>
    </div>
  )
}
