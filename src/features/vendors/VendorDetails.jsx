import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatValue, getValue } from '../../lib/format'
import { isActiveStatus } from '../../lib/status'
import { Icon } from '../../components/Icon'

export default function VendorDetails({ vendor, address, onClose, mediaMap, subMediaMap }) {
  const [documentLoading, setDocumentLoading] = useState(false)

  if (!vendor) return null

  const statusValue = getValue(vendor, ['status'])
  const isActive = isActiveStatus(statusValue)
  const mediaName = mediaMap?.[vendor.media_id] || getValue(vendor, ['media'])
  const subMediaName = subMediaMap?.[vendor.sub_media_id] || getValue(vendor, ['sub_media'])

  const documentPath = vendor.vendor_document_file_path
  const documentName = vendor.vendor_document_file_name

  async function getSignedUrl() {
    if (!documentPath) return null
    const { data, error } = await supabase
      .storage
      .from('Dikho')
      .createSignedUrl(documentPath, 60 * 10)
    if (error) throw error
    return data?.signedUrl
  }

  async function openDocument() {
    if (!documentPath) return
    setDocumentLoading(true)
    try {
      const url = await getSignedUrl()
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      console.error(error)
      window.alert(`Could not open document: ${error.message}`)
    } finally {
      setDocumentLoading(false)
    }
  }

  async function downloadDocument() {
    if (!documentPath) return
    setDocumentLoading(true)
    try {
      const url = await getSignedUrl()
      if (url) {
        const a = document.createElement('a')
        a.href = url
        a.download = documentName || 'document'
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (error) {
      console.error(error)
      window.alert(`Could not download document: ${error.message}`)
    } finally {
      setDocumentLoading(false)
    }
  }

  const sections = [
    { title: 'Basic Information', fields: [
      ['ID', vendor.id],
      ['Alias', vendor.alias],
      ['Company Name', vendor.company_name],
      ['Contact Person', vendor.contact_person],
      ['Vendor Type', vendor.vendor_type],
      ['Email', vendor.email],
      ['Contact Number', vendor.contact == null ? null : `${vendor.country_dialcode || ''} ${vendor.contact}`.trim()],
      ['Status', isActive ? 'Active' : 'Inactive'],
    ]},
    { title: 'Classification', fields: [
      ['Media', mediaName],
      ['Sub Media', subMediaName],
    ]},
    { title: 'Payment Terms', fields: [
      ['Payment Term Type', vendor.payment_term_type],
      ['Payment Term Date', vendor.payment_term_invoice_date],
      ['Payment Term (In Days)', vendor.payment_term_value],
    ]},
    { title: 'Tax Information', fields: [
      ['Registration', vendor.registration],
      ['GSTIN', vendor.gstin],
      ['GSTIN Date', vendor.gstin_date],
      ['PAN Number', vendor.pan_number],
      ['TDS Percentage', vendor.tds_percentage == null ? null : `${vendor.tds_percentage}%`],
      ['TDS Section', vendor.tds_section],
      ['Opening Balance', vendor.opening_balance],
    ]},
    { title: 'Bank Details', fields: [
      ['Bank Name', vendor.vendor_bank_name],
      ['Bank IFSC Code', vendor.vendor_ifsc_code],
      ['Account Number', vendor.vendor_account_number],
    ]},
    { title: 'Address', fields: [
      ['Country', address?.country],
      ['State', address?.state],
      ['City', address?.city],
      ['Zipcode', address?.zipcode],
      ['Address', address?.address],
    ]},
  ]

  return (
    <aside className="details-drawer" aria-label="Vendor details">
      <div className="drawer-header">
        <div>
          <span className="drawer-kicker">VENDOR DETAILS</span>
          <h2>{formatValue(vendor.company_name)}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="close" size={19} />
        </button>
      </div>
      <div className="drawer-divider" />

      {documentPath && (
        <div className="document-panel">
          <div className="document-panel-icon"><Icon name="file" size={20} /></div>
          <div className="document-panel-main">
            <div className="document-panel-title">Vendor document</div>
            <div className="document-panel-name" title={documentName || documentPath}>{formatValue(documentName)}</div>
          </div>
          <div className="document-panel-actions">
            <button className="icon-button small" onClick={openDocument} disabled={documentLoading} aria-label="View vendor document" title="View">
              {documentLoading ? '…' : <Icon name="eye" size={17} />}
            </button>
            <button className="icon-button small" onClick={downloadDocument} disabled={documentLoading} aria-label="Download vendor document" title="Download">
              <Icon name="download" size={17} />
            </button>
          </div>
        </div>
      )}

      <div className="details-list">
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
