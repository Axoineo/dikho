import { formatValue, getValue } from '../../lib/format'
import { Icon } from '../../components/Icon'

export default function ClientDetails({ client, onClose }) {
  if (!client) return null

  const statusValue = getValue(client, ['status', 'is_active'])
  const fields = [
    ['ID', getValue(client, ['id'])],
    ['Company Name', getValue(client, ['company_name'])],
    ['Contact Person', getValue(client, ['contact_person'])],
    ['Contact Number', getValue(client, ['contact', 'contact_number', 'phone'])],
    ['Email', getValue(client, ['email', 'email_address'])],
    ['Status', statusValue === 1 || statusValue === '1' || statusValue === true || statusValue === 'true' || statusValue === 'active' || statusValue === 'Active' ? 'Active' : 'Inactive'],
    ['TDS Percentage', getValue(client, ['tds_percentage', 'tds_percent', 'tdsPercentage'])],
    ['TDS Section', getValue(client, ['tds_section', 'tdsSection'])],
    ['Registration', getValue(client, ['registration', 'registration_type', 'registrationType'])],
    ['GSTIN', getValue(client, ['gstin', 'gstin_number'])],
    ['GSTIN Date', getValue(client, ['gstin_date', 'gstinDate'])],
    ['PAN Number', getValue(client, ['pan_number', 'pan'])],
    ['Designation', getValue(client, ['designation'])],
    ['Address Line 1', getValue(client, ['address_line1'])],
    ['Address Line 2', getValue(client, ['address_line2'])],
    ['City', getValue(client, ['city'])],
    ['State', getValue(client, ['state'])],
    ['Pincode', getValue(client, ['pincode'])],
    ['Country', getValue(client, ['country'])],
  ]

  return (
    <aside className="details-drawer" aria-label="Client details">
      <div className="drawer-header">
        <div>
          <span className="drawer-kicker">Client details</span>
          <h2>{formatValue(client.company_name)}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="close" size={19} />
        </button>
      </div>

      <div className="drawer-divider" />

      <div className="details-list">
        {fields.map(([label, value]) => (
          <div className="detail-row" key={label}>
            <span className="detail-label">{label}</span>
            <span className="detail-value">{formatValue(value)}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
