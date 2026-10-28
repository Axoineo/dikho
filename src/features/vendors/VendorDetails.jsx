import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDisplayDate, formatPhone, formatRupees } from '../../lib/format'
import { isActiveStatus } from '../../lib/status'
import { Icon } from '../../components/Icon'
import { DetailsPanel, Section, KeyValues, StatusPill } from '../../components/crm/CrmUi'

export default function VendorDetails({ vendor, address, onClose, onEdit, mediaMap, subMediaMap }) {
  const [documentBusy, setDocumentBusy] = useState(false)
  const [documentError, setDocumentError] = useState('')

  if (!vendor) return null

  const active = isActiveStatus(vendor.status)
  const phone = formatPhone(vendor.country_dialcode, vendor.contact)
  const documentPath = vendor.vendor_document_file_path
  const documentName = vendor.vendor_document_file_name
  const terms = vendor.payment_term_value != null && vendor.payment_term_value !== ''
    ? `${vendor.payment_term_value} days from ${String(vendor.payment_term_type || 'invoice date').toLowerCase()}`
    : null

  // A short-lived signed link, made only when someone asks for the file.
  async function withDocument(action) {
    if (!documentPath) return
    setDocumentBusy(true)
    setDocumentError('')
    try {
      const { data, error } = await supabase.storage.from('Dikho').createSignedUrl(documentPath, 60 * 10)
      if (error) throw error
      if (data?.signedUrl) action(data.signedUrl)
    } catch (error) {
      console.error(error)
      setDocumentError(`Could not open the document: ${error.message}`)
    } finally {
      setDocumentBusy(false)
    }
  }

  function openDocument() {
    withDocument((url) => window.open(url, '_blank', 'noopener,noreferrer'))
  }

  function downloadDocument() {
    withDocument((url) => {
      const link = document.createElement('a')
      link.href = url
      link.download = documentName || 'document'
      link.rel = 'noopener noreferrer'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    })
  }

  return (
    <DetailsPanel
      label="Vendor details"
      title={vendor.company_name || 'Unnamed vendor'}
      monogram={vendor.company_name}
      meta={<>
        <StatusPill tone={active ? 'active' : 'inactive'}>{active ? 'Active' : 'Inactive'}</StatusPill>
        <span>{[vendor.vendor_type, `Vendor #${vendor.id}`].filter(Boolean).join(' · ')}</span>
      </>}
      onClose={onClose}
      actions={onEdit && (
        <button type="button" className="crm-btn crm-btn--secondary crm-btn--sm" onClick={onEdit}>
          <Icon name="edit" size={15} /> Edit
        </button>
      )}
    >
      {documentPath && (
        <div className="crm-file">
          <span className="crm-file-icon"><Icon name="file" size={18} /></span>
          <div className="crm-file-main">
            <div className="crm-file-title">Document</div>
            <div className="crm-file-name" title={documentName || ''}>{documentName || 'Vendor document'}</div>
          </div>
          <button type="button" className="crm-icon-btn" onClick={openDocument} disabled={documentBusy} aria-label="View document" title="View">
            <Icon name="eye" size={17} />
          </button>
          <button type="button" className="crm-icon-btn" onClick={downloadDocument} disabled={documentBusy} aria-label="Download document" title="Download">
            <Icon name="download" size={17} />
          </button>
        </div>
      )}
      {documentError && <div className="crm-note crm-note--danger" role="alert">{documentError}</div>}

      <Section title="Contact">
        <KeyValues items={[
          { label: 'Contact person', value: vendor.contact_person, keep: true },
          { label: 'Alias', value: vendor.alias },
          { label: 'Phone', value: phone, href: phone ? `tel:${phone.replace(/\s+/g, '')}` : null, mono: true, keep: true },
          { label: 'Email', value: vendor.email, href: vendor.email ? `mailto:${vendor.email}` : null, wide: true, keep: true },
        ]} />
      </Section>

      <Section title="Media and terms">
        <KeyValues items={[
          { label: 'Media', value: mediaMap?.[vendor.media_id], keep: true },
          { label: 'Sub media', value: subMediaMap?.[vendor.sub_media_id], keep: true },
          { label: 'Payment term', value: terms, wide: true, keep: true },
          { label: 'Payment term date', value: vendor.payment_term_invoice_date && formatDisplayDate(vendor.payment_term_invoice_date) },
        ]} />
      </Section>

      <Section title="Tax">
        <KeyValues items={[
          { label: 'GSTIN', value: vendor.gstin, mono: true, keep: true },
          { label: 'PAN', value: vendor.pan_number, mono: true, keep: true },
          { label: 'Registration', value: vendor.registration },
          { label: 'GSTIN date', value: vendor.gstin_date && formatDisplayDate(vendor.gstin_date) },
          { label: 'TDS', value: vendor.tds_percentage != null && vendor.tds_percentage !== '' ? `${vendor.tds_percentage}%` : null },
          { label: 'TDS section', value: vendor.tds_section },
          { label: 'Opening balance', value: vendor.opening_balance ? formatRupees(vendor.opening_balance) : null, mono: true },
        ]} />
      </Section>

      <Section title="Bank account">
        <KeyValues items={[
          { label: 'Bank', value: vendor.vendor_bank_name, keep: true },
          { label: 'IFSC', value: vendor.vendor_ifsc_code, mono: true },
          { label: 'Account number', value: vendor.vendor_account_number, mono: true, wide: true },
        ]} />
      </Section>

      <Section title="Address">
        <KeyValues items={[
          { label: 'Street', value: address?.address, wide: true, keep: true },
          { label: 'City', value: address?.city },
          { label: 'State', value: address?.state },
          { label: 'PIN code', value: address?.zipcode, mono: true },
          { label: 'Country', value: address?.country },
        ]} />
      </Section>
    </DetailsPanel>
  )
}
