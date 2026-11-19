import 'dart:io';

import 'package:dikho_crm/features/sales_orders/tax_invoice.dart';
import 'package:flutter_test/flutter_test.dart';

// The phone draws the tax invoice itself (PdfBox on Android), so its layout must stay
// the web's. Expected values below were produced by the web's own functions
// (formatMoney, numberToWords, invoiceGstRate) in Node.

void main() {
  test('money as the web prints it on the invoice', () {
    for (final (value, expected) in const <(Object?, String)>[
      (0, '0.00'),
      (1, '1.00'),
      (999.995, '1,000.00'),
      (1234.5, '1,234.50'),
      (100000, '1,00,000.00'),
      (1234567.891, '12,34,567.89'),
      (-2500.5, '-2,500.50'),
      ('1800', '1,800.00'),
      (null, '—'),
      ('', '—'),
    ]) {
      expect(invoiceMoney(value), expected, reason: '$value');
    }
  });

  test('the total in words, as the web writes it', () {
    for (final (value, expected) in const <(Object?, String)>[
      (0, ''),
      (1, 'One Rupees Only'),
      (19, 'Nineteen Rupees Only'),
      (20, 'Twenty Rupees Only'),
      (21, 'Twenty-One Rupees Only'),
      (99, 'Ninety-Nine Rupees Only'),
      (100, 'One Hundred Rupees Only'),
      (101, 'One Hundred and One Rupees Only'),
      (999, 'Nine Hundred and Ninety-Nine Rupees Only'),
      (1000, 'One Thousand Rupees Only'),
      (1001, 'One Thousand One Rupees Only'),
      (15000, 'Fifteen Thousand Rupees Only'),
      (99999, 'Ninety-Nine Thousand Nine Hundred and Ninety-Nine Rupees Only'),
      (100000, 'One Lakh Rupees Only'),
      (123456, 'One Lakh Twenty-Three Thousand Four Hundred and Fifty-Six Rupees Only'),
      (1180000.75, 'Eleven Lakh Eighty Thousand Rupees Only'),
      (12345678, 'One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred and Seventy-Eight Rupees Only'),
      (100000000, 'Ten Crore Rupees Only'),
    ]) {
      expect(amountInWords(value), expected, reason: '$value');
    }
  });

  test('the GST % printed on a line, as the web works it out', () {
    for (final (taxable, tax, expected) in const <(Object?, Object?, String)>[
      (1000, 180, '18'),
      (1000, 0, '0'),
      (0, 50, '-'),
      (1000, 175, '17.5'),
      (999.99, 180, '18'),
      (57, 2.85, '5'),
      (100, 28, '28'),
      ('1000', '50', '5'),
      (null, null, '0'),
      (333.33, 60, '18'),
    ]) {
      expect(invoiceGstRate(taxable, tax), expected, reason: '$taxable / $tax');
    }
  });

  test('the layout: positions, blanks skipped, PO number fallback, tax grouped by HSN and rate', () {
    final ops = taxInvoiceLayout(
      {
        'id': 42,
        'company': 'Client Co',
        'order_client_fullname': '',
        'client_gstin': '24ABCDE1234F1Z5',
        'order_number': '',
        'order_date': '2026-11-10',
        'crm_reference_id': 'CRM-7',
        'sub_total': 2000,
        'total': 2360,
        'tax_total': 360,
      },
      [
        {'name': 'Hoarding', 'hsn_sac': '998361', 'taxable_amount': 1000, 'tax_amount': 180, 'after_tax_amount': 1180},
        {'short_name': 'Print', 'hsn_sac': '998361', 'taxable_amount': 1000, 'tax_amount': 180, 'after_tax_amount': 1180},
      ],
    );
    InvoiceText at(double x, double y) => ops.firstWhere((o) => o.x == x && o.y == y);
    expect(at(24, 706.170).text, 'Client Co');
    expect(at(24, 706.170).bold, isTrue);
    expect(ops.where((o) => o.y == 691.920), isEmpty, reason: 'no contact person: nothing drawn');
    expect(at(60, 649.920).text, '24ABCDE1234F1Z5');
    expect(at(246.867, 649.920).text, '24ABCDE1234F1Z5', reason: 'ship to repeats bill to');
    expect(ops.where((o) => o.y == 634.920), isEmpty, reason: 'no PAN');
    expect(at(494.344, 706.170).text, 'SO-42', reason: 'no order number');
    expect(at(494.344, 672.920).text, 'CRM-7', reason: 'no PO number: the CRM reference');
    expect(at(50.297, 601.170).text, 'Hoarding');
    expect(at(50.297, 581.170).text, 'Print', reason: 'the short name when there is no name, 20 points lower');
    expect(at(415, 601.170).text, '18');
    expect(at(415, 601.170).right, isTrue);
    expect(at(315, 312.420).text, '2');
    expect(at(67.746, 212.670).text, 'Two Thousand Three Hundred and Sixty Rupees Only');
    expect(at(575, 214.920).text, '2,360.00');
    expect(ops.where((o) => o.y == 178.170 && o.x == 110).single.text, '998361');
    expect(ops.where((o) => o.y == 166.170), isEmpty, reason: 'both lines share HSN and rate: one tax row');
    expect(at(310, 178.170).text, '2,000.00');
    expect(at(572, 160.920).text, '360.00', reason: 'clear of the ₹ the template prints at x 510 to 516');
    expect(at(572, 178.170).text, '360.00');
    expect(at(372, 601.170).text, '1,000.00', reason: "inside the Rate column's line");
  });

  test('the file name is safe and as the web names it', () {
    expect(taxInvoiceFileName({'order_number': 'SO/24-25/017', 'id': 9}), 'TI_SO_24-25_017.pdf');
    expect(taxInvoiceFileName({'id': 9}), 'TI_9.pdf');
  });

  test("the app's template and fonts are the web's own files", () {
    for (final name in ['SO_template.pdf', 'Roboto-Regular.ttf', 'Roboto-Medium.ttf']) {
      final web = File('../public/Temps/$name');
      final app = File('android/app/src/main/assets/invoice/$name');
      expect(app.readAsBytesSync(), web.readAsBytesSync(), reason: '$name differs from public/Temps');
    }
  });
}
