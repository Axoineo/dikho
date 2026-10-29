import { formatDisplayDate, formatPhone } from '../../lib/format'
import { isActiveStatus } from '../../lib/status'
import { Icon } from '../../components/Icon'
import { DetailsPanel, Section, KeyValues, StatusPill } from '../../components/crm/CrmUi'

export default function ClientDetails({ client, onClose, onEdit, onNewOrder }) {
  if (!client) return null

  const active = isActiveStatus(client.status)
  const phone = formatPhone(client.country_dialcode, client.contact)
  const address = [client.address_line1, client.address_line2].filter(Boolean).join(', ')
  const place = [client.city, client.state, client.pincode].filter(Boolean).join(', ')

  return (
    <DetailsPanel
      label="Client details"
      title={client.company_name || 'Unnamed client'}
      monogram={client.company_name}
      meta={<><StatusPill tone={active ? 'active' : 'inactive'}>{active ? 'Active' : 'Inactive'}</StatusPill><span>Client #{client.id}</span></>}
      onClose={onClose}
      actions={(onEdit || onNewOrder) && (
        <>
          {onNewOrder && (
            <button type="button" className="crm-btn crm-btn--secondary crm-btn--sm" onClick={onNewOrder}>
              <Icon name="plus" size={15} /> New order
            </button>
          )}
          {onEdit && (
            <button type="button" className="crm-btn crm-btn--secondary crm-btn--sm" onClick={onEdit}>
              <Icon name="edit" size={15} /> Edit
            </button>
          )}
        </>
      )}
    >
      <Section title="Contact">
        <KeyValues items={[
          { label: 'Contact person', value: client.contact_person, keep: true },
          { label: 'Designation', value: client.designation },
          { label: 'Phone', value: phone, href: phone ? `tel:${phone.replace(/\s+/g, '')}` : null, mono: true, keep: true },
          { label: 'Email', value: client.email, href: client.email ? `mailto:${client.email}` : null, wide: true, keep: true },
        ]} />
      </Section>

      <Section title="Tax">
        <KeyValues items={[
          { label: 'GSTIN', value: client.gstin, mono: true, keep: true },
          { label: 'PAN', value: client.pan_number, mono: true, keep: true },
          { label: 'Registration', value: client.registration },
          { label: 'GSTIN date', value: client.gstin_date && formatDisplayDate(client.gstin_date) },
          { label: 'TDS', value: client.tds_percentage != null && client.tds_percentage !== '' ? `${client.tds_percentage}%` : null },
          { label: 'TDS section', value: client.tds_section },
        ]} />
      </Section>

      <Section title="Address">
        <KeyValues items={[
          { label: 'Address', value: address, wide: true, keep: true },
          { label: 'City, state, PIN', value: place, wide: true },
          { label: 'Country', value: client.country },
        ]} />
      </Section>
    </DetailsPanel>
  )
}
