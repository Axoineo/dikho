import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { supabase } from './supabase'

function formatMoney(value) {
  if (value === null || value === undefined) return '0.00'
  return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function numberToWords(num) {
  if (!num || isNaN(num) || num === 0) return ''
  const a = ['','One ','Two ','Three ','Four ', 'Five ','Six ','Seven ','Eight ','Nine ','Ten ','Eleven ','Twelve ','Thirteen ','Fourteen ','Fifteen ','Sixteen ','Seventeen ','Eighteen ','Nineteen ']
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  const inWords = (n) => {
    if (n < 20) return a[n]
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? '-' + a[n % 10] : ' ')
    if (n < 1000) return a[Math.floor(n / 100)] + 'Hundred ' + (n % 100 !== 0 ? 'and ' + inWords(n % 100) : '')
    if (n < 100000) return inWords(Math.floor(n / 1000)) + 'Thousand ' + (n % 1000 !== 0 ? inWords(n % 1000) : '')
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + 'Lakh ' + (n % 100000 !== 0 ? inWords(n % 100000) : '')
    return inWords(Math.floor(n / 10000000)) + 'Crore ' + (n % 10000000 !== 0 ? inWords(n % 10000000) : '')
  }
  return inWords(Math.floor(num)).trim() + ' Rupees Only'
}

export async function generateTaxInvoice(templatePath, orderData) {
  const { data: items, error } = await supabase
    .from('salesorderdocument')
    .select('*')
    .eq('sales_order_id', orderData.id)
    .order('id', { ascending: true })

  if (error) throw new Error(`Could not load order items: ${error.message}`)

  const response = await fetch(templatePath)
  if (!response.ok) throw new Error(`Failed to load template: ${response.statusText}`)
  
  const templateBytes = await response.arrayBuffer()
  const pdfDoc = await PDFDocument.load(templateBytes)
  const page = pdfDoc.getPages()[0] 

  pdfDoc.registerFontkit(fontkit)
  const [fontRegBytes, fontBldBytes] = await Promise.all([
    fetch('/Temps/Roboto-Regular.ttf').then(res => res.arrayBuffer()),
    fetch('/Temps/Roboto-Medium.ttf').then(res => res.arrayBuffer())
  ])
  const fontReg = await pdfDoc.embedFont(fontRegBytes)
  const fontBld = await pdfDoc.embedFont(fontBldBytes)
  
  const draw = (text, x, y, size, isBold = false) => {
    if (!text) return
    page.drawText(String(text), {
      x, y, size, font: isBold ? fontBld : fontReg, color: rgb(0, 0, 0)
    })
  }

  const drawRight = (text, rightX, y, size, isBold = false) => {
    if (!text) return
    const fontToUse = isBold ? fontBld : fontReg
    const str = String(text)
    const textWidth = fontToUse.widthOfTextAtSize(str, size)
    page.drawText(str, {
      x: rightX - textWidth, y, size, font: fontToUse, color: rgb(0, 0, 0)
    })
  }

  // 1. Header Data
  const company = orderData.company || ''
  const contactPerson = orderData.order_client_fullname || ''
  
  // Bill To (Avoid drawing "GSTIN:" since it's pre-printed in the template at X:24)
  draw(company, 24, 706.170, 9.75, true)
  if (contactPerson) draw(contactPerson, 24, 691.920, 9.0)
  if (orderData.client_gstin) draw(orderData.client_gstin, 60, 649.920, 9.0)
  if (orderData.client_pan) draw(orderData.client_pan, 51, 634.920, 9.0)

  // Ship To
  draw(company, 210.867, 706.170, 9.75, true)
  if (contactPerson) draw(contactPerson, 210.867, 691.920, 9.0)
  if (orderData.client_gstin) draw(orderData.client_gstin, 246.867, 649.920, 9.0)
  if (orderData.client_pan) draw(orderData.client_pan, 237.867, 634.920, 9.0)

  // Invoice Details
  draw(orderData.order_number || `SO-${orderData.id}`, 494.344, 706.170, 9.75)
  draw(orderData.order_date || '', 494.344, 688.920, 9.0)
  draw(orderData.po_number || orderData.crm_reference_id || '', 494.344, 672.920, 9.0)
  draw(orderData.po_date || '', 494.344, 655.920, 9.0)

  // 2. Items Data (Top Table)
  // X-coords carefully measured to fit strictly within vertical lines. No ₹ symbol (it's pre-printed).
  let currentY = 601.170
  if (items && items.length > 0) {
    items.forEach((item, index) => {
      drawRight(index + 1, 35, currentY, 9.0) // SN
      draw(item.name || item.short_name || 'Item', 50.297, currentY, 9.0) // Name
      draw(item.hsn_sac || '', 226, currentY, 9.0) // HSN/SAC
      drawRight('1 PCS', 315, currentY, 9.0) // Qty
      drawRight(formatMoney(item.taxable_amount), 375, currentY, 9.0) // Rate
      
      const gstPct = item.gst_type ? item.gst_type.replace(/[^0-9]/g, '') : '0'
      drawRight(gstPct, 415, currentY, 9.0) // GST %
      
      drawRight(formatMoney(item.taxable_amount), 495, currentY, 9.0) // Taxable Value
      drawRight(formatMoney(item.after_tax_amount), 575, currentY, 9.0) // Total Amount
      
      currentY -= 20
    })
  }

  // 3. Mid Totals (Bottom of Top Table)
  drawRight(items?.length || '1', 315, 312.420, 9.75) // Total Qty
  drawRight(formatMoney(orderData.sub_total), 495, 312.420, 9.75, true) // Mid Taxable Sum
  drawRight(formatMoney(orderData.total), 575, 312.420, 9.75, true) // Mid Total Sum
  drawRight(formatMoney(orderData.sub_total), 575, 295.920, 9.0) // Taxable Value (below table)

  // 4. Bottom Totals (Words & Grand Total)
  draw(numberToWords(orderData.total), 67.746, 212.670, 9.0)
  drawRight(formatMoney(orderData.total), 575, 214.920, 9.75, true)

  // 5. Tax Table (Bottom Table)
  // To prevent breaking the fixed 2-row layout of the static PDF template, we aggregate taxes by HSN/GST%.
  const taxGroups = {}
  if (items) {
    items.forEach(item => {
      const hsn = item.hsn_sac || '-'
      const gstPct = item.gst_type ? item.gst_type.replace(/[^0-9]/g, '') : '-'
      const key = `${hsn}_${gstPct}`
      if (!taxGroups[key]) taxGroups[key] = { hsn, gstPct, taxable: 0, tax: 0 }
      taxGroups[key].taxable += Number(item.taxable_amount) || 0
      taxGroups[key].tax += Number(item.tax_amount) || 0
    })
  }
  const groupedTaxes = Object.values(taxGroups)
  
  let taxY = 178.170
  groupedTaxes.forEach((group, index) => {
    drawRight(index + 1, 45, taxY, 9.0) // SN
    draw(group.hsn, 110, taxY, 9.0) // HSN
    drawRight(formatMoney(group.taxable), 310, taxY, 9.0) // Taxable
    drawRight(group.gstPct, 420, taxY, 9.0) // GST %
    drawRight(formatMoney(group.tax), 540, taxY, 9.0) // Total Tax
    taxY -= 12
  })

  // Tax Table Totals Row (Strictly fixed at Y=160.920 per the template's bottom line)
  drawRight(formatMoney(orderData.sub_total), 310, 160.920, 9.0, true)
  drawRight(formatMoney(orderData.tax_total), 540, 160.920, 9.0, true)

  // 6. Output PDF
  const pdfBytes = await pdfDoc.save()
  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `TI_${orderData.order_number || orderData.id || 'invoice'}.pdf`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
