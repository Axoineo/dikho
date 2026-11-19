import 'sales_orders_models.dart';

/// One piece of text on the tax invoice, in PDF points from the page's bottom left,
/// as src/features/invoices/generateTaxInvoice.js places it on /Temps/SO_template.pdf.
/// [right] means [x] is where the text ends (drawRight), measured with its font.
class InvoiceText {
  const InvoiceText(this.text, this.x, this.y, this.size, {this.bold = false, this.right = false});

  final String text;
  final double x;
  final double y;
  final double size;
  final bool bold;
  final bool right;

  Map<String, Object> toJson() => {'t': text, 'x': x, 'y': y, 's': size, 'b': bold, 'r': right};

  @override
  String toString() => '${right ? '…' : ''}$text@($x,$y)';
}

/// formatMoney in src/lib/format.js, which the invoice uses: en-IN grouping always,
/// two decimals, no rupee sign (the template prints it), a dash for no value.
String invoiceMoney(Object? value) {
  if (value == null || (value is String && value.isEmpty)) return '—';
  if (value is String && double.tryParse(value.trim()) == null) return value;
  return plainMoney(value);
}

/// numberToWords in src/lib/money.js: whole rupees in the Indian system, "Rupees
/// Only" after; empty for nothing or zero.
String amountInWords(Object? value) {
  final amount = toAmount(value);
  if (amount == 0) return '';
  const ones = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', //
    'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen ',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  String words(int n) {
    if (n < 0) return words(-n);
    if (n < 20) return ones[n];
    if (n < 100) return tens[n ~/ 10] + (n % 10 != 0 ? '-${ones[n % 10]}' : ' ');
    if (n < 1000) return '${ones[n ~/ 100]}Hundred ${n % 100 != 0 ? 'and ${words(n % 100)}' : ''}';
    if (n < 100000) return '${words(n ~/ 1000)}Thousand ${n % 1000 != 0 ? words(n % 1000) : ''}';
    if (n < 10000000) return '${words(n ~/ 100000)}Lakh ${n % 100000 != 0 ? words(n % 100000) : ''}';
    return '${words(n ~/ 10000000)}Crore ${n % 10000000 != 0 ? words(n % 10000000) : ''}';
  }

  return '${words(amount.floor()).trim()} Rupees Only';
}

/// invoiceGstRate in src/lib/gst.js: the GST % printed on a line, read back from its
/// amounts (gst_type only says how tax is split). No tax prints 0, a standard slab
/// to the paisa prints that slab, a custom tax prints its real rate, and tax on a
/// zero taxable amount has no rate: '-'.
String invoiceGstRate(Object? taxableAmount, Object? taxAmount) {
  final taxable = round2(taxableAmount);
  final tax = round2(taxAmount);
  if (tax == 0) return '0';
  if (taxable == 0) return '-';
  for (final rate in gstRates) {
    if (taxFromRate(taxable, rate) == tax) return '$rate';
  }
  return numberText(round2(tax / taxable * 100));
}

String _text(Object? value) => value == null ? '' : value.toString();

/// Everything drawn on the invoice for [order] (a salesorder row) and its [items]
/// (its salesorderdocument rows, oldest first), exactly as generateTaxInvoice.js
/// draws it. Empty values are skipped, as its draw() skips them.
List<InvoiceText> taxInvoiceLayout(Map<String, dynamic> order, List<Map<String, dynamic>> items) {
  final out = <InvoiceText>[];
  void draw(String text, double x, double y, double size, {bool bold = false}) {
    if (text.isNotEmpty) out.add(InvoiceText(text, x, y, size, bold: bold));
  }

  void drawRight(String text, double x, double y, double size, {bool bold = false}) {
    if (text.isNotEmpty) out.add(InvoiceText(text, x, y, size, bold: bold, right: true));
  }

  // 1. Header: bill to and ship to (GSTIN and PAN labels are printed on the template).
  final company = _text(order['company']);
  final contact = _text(order['order_client_fullname']);
  for (final x in [24.0, 210.867]) {
    draw(company, x, 706.170, 9.75, bold: true);
    draw(contact, x, 691.920, 9.0);
    draw(_text(order['client_gstin']), x + 36, 649.920, 9.0);
    draw(_text(order['client_pan']), x + 27, 634.920, 9.0);
  }

  // Invoice details.
  final number = _text(order['order_number']);
  final po = _text(order['po_number']);
  draw(number.isNotEmpty ? number : 'SO-${_text(order['id'])}', 494.344, 706.170, 9.75);
  draw(_text(order['order_date']), 494.344, 688.920, 9.0);
  draw(po.isNotEmpty ? po : _text(order['crm_reference_id']), 494.344, 672.920, 9.0);
  draw(_text(order['po_date']), 494.344, 655.920, 9.0);

  // 2. The lines, 20 points apart.
  var y = 601.170;
  for (final (index, item) in items.indexed) {
    final name = _text(item['name']).isNotEmpty
        ? _text(item['name'])
        : _text(item['short_name']).isNotEmpty
        ? _text(item['short_name'])
        : 'Item';
    drawRight('${index + 1}', 35, y, 9.0);
    draw(name, 50.297, y, 9.0);
    draw(_text(item['hsn_sac']), 226, y, 9.0);
    drawRight('1 PCS', 315, y, 9.0);
    // Ends before the column's line at 375, which hid the last digit.
    drawRight(invoiceMoney(item['taxable_amount']), 372, y, 9.0);
    drawRight(invoiceGstRate(item['taxable_amount'], item['tax_amount']), 415, y, 9.0);
    drawRight(invoiceMoney(item['taxable_amount']), 495, y, 9.0);
    drawRight(invoiceMoney(item['after_tax_amount']), 575, y, 9.0);
    y -= 20;
  }

  // 3. Totals under the lines.
  drawRight(items.isEmpty ? '1' : '${items.length}', 315, 312.420, 9.75);
  drawRight(invoiceMoney(order['sub_total']), 495, 312.420, 9.75, bold: true);
  drawRight(invoiceMoney(order['total']), 575, 312.420, 9.75, bold: true);
  drawRight(invoiceMoney(order['sub_total']), 575, 295.920, 9.0);

  // 4. The total in words, and the grand total.
  draw(amountInWords(order['total']), 67.746, 212.670, 9.0);
  drawRight(invoiceMoney(order['total']), 575, 214.920, 9.75, bold: true);

  // 5. Tax table: grouped by HSN and rate, so it fits the template's fixed rows.
  final groups = <String, ({String hsn, String rate, double taxable, double tax})>{};
  for (final item in items) {
    final hsn = _text(item['hsn_sac']).isNotEmpty ? _text(item['hsn_sac']) : '-';
    final rate = invoiceGstRate(item['taxable_amount'], item['tax_amount']);
    final key = '${hsn}_$rate';
    final was = groups[key];
    groups[key] = (
      hsn: hsn,
      rate: rate,
      taxable: (was?.taxable ?? 0) + toAmount(item['taxable_amount']),
      tax: (was?.tax ?? 0) + toAmount(item['tax_amount']),
    );
  }
  var taxY = 178.170;
  for (final (index, group) in groups.values.indexed) {
    drawRight('${index + 1}', 45, taxY, 9.0);
    draw(group.hsn, 110, taxY, 9.0);
    drawRight(invoiceMoney(group.taxable), 310, taxY, 9.0);
    drawRight(group.rate, 420, taxY, 9.0);
    // The template prints ₹ at x 510 to 516: ending at 540 put 180.00 under it.
    drawRight(invoiceMoney(group.tax), 572, taxY, 9.0);
    taxY -= 12;
  }

  // The tax table's totals row, fixed on the template's bottom line.
  drawRight(invoiceMoney(order['sub_total']), 310, 160.920, 9.0, bold: true);
  drawRight(invoiceMoney(order['tax_total']), 572, 160.920, 9.0, bold: true);
  return out;
}

/// The file name the web gives the download.
String taxInvoiceFileName(Map<String, dynamic> order) {
  final number = _text(order['order_number']);
  final id = _text(order['id']);
  final name = number.isNotEmpty ? number : (id.isNotEmpty ? id : 'invoice');
  return 'TI_${name.replaceAll(RegExp(r'[\\/:*?"<>|\s]+'), '_')}.pdf';
}
