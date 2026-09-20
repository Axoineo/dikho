import { isActiveStatus } from '../../lib/status'
import { primaryAddress } from './vendorFilters'

export const VENDOR_EXPORT_COLUMNS = [
  ['ID', (vendor) => vendor.id],
  ['Alias', (vendor) => vendor.alias],
  ['Company Name', (vendor) => vendor.company_name],
  ['Contact Person', (vendor) => vendor.contact_person],
  ['Vendor Type', (vendor) => vendor.vendor_type],
  ['Email', (vendor) => vendor.email],
  ['Contact Number', (vendor) => (vendor.contact == null ? '' : `${vendor.country_dialcode || ''} ${vendor.contact}`.trim())],
  ['Media', (vendor, maps) => maps.mediaMap[vendor.media_id] || ''],
  ['Sub Media', (vendor, maps) => maps.subMediaMap[vendor.sub_media_id] || ''],
  ['Status', (vendor) => (isActiveStatus(vendor.status) ? 'Active' : 'Inactive')],
  ['Payment Term Type', (vendor) => vendor.payment_term_type],
  ['Payment Term Date', (vendor) => vendor.payment_term_invoice_date],
  ['Payment Term (In Days)', (vendor) => vendor.payment_term_value],
  ['Registration', (vendor) => vendor.registration],
  ['GSTIN', (vendor) => vendor.gstin],
  ['GSTIN Date', (vendor) => vendor.gstin_date],
  ['PAN Number', (vendor) => vendor.pan_number],
  ['TDS Percentage', (vendor) => vendor.tds_percentage],
  ['TDS Section', (vendor) => vendor.tds_section],
  ['Opening Balance', (vendor) => vendor.opening_balance],
  ['Bank Name', (vendor) => vendor.vendor_bank_name],
  ['Bank IFSC Code', (vendor) => vendor.vendor_ifsc_code],
  ['Account Number', (vendor) => vendor.vendor_account_number],
  ['Country', (vendor) => primaryAddress(vendor)?.country],
  ['State', (vendor) => primaryAddress(vendor)?.state],
  ['City', (vendor) => primaryAddress(vendor)?.city],
  ['Zipcode', (vendor) => primaryAddress(vendor)?.zipcode],
  ['Address', (vendor) => primaryAddress(vendor)?.address],
  ['Document', (vendor) => vendor.vendor_document_file_name],
]

export function vendorExportWorkbook(vendors, maps) {
  return {
    sheetName: 'Vendors',
    headers: VENDOR_EXPORT_COLUMNS.map(([header]) => header),
    rows: vendors.map((vendor) => VENDOR_EXPORT_COLUMNS.map(([, read]) => {
      const value = read(vendor, maps)
      return value === null || value === undefined ? '' : value
    })),
  }
}
