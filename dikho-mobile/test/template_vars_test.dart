import 'package:dikho_crm/features/whatsapp/contacts_models.dart';
import 'package:dikho_crm/features/whatsapp/template_vars.dart';
import 'package:flutter_test/flutter_test.dart';

// The app's copy of src/lib/templateVars.js must read a variable map exactly as the
// server does. Every expectation below is what the JS returns for the same input
// (run through origin/main's templateVars.js on 2026-11-09).

void main() {
  test('tokens: ordered, de-duplicated, invalid ones ignored', () {
    expect(extractTokens('Hi {{ name }}, {{1}} and {{name}} {{ Customer_Name }} {{bad!}}'), ['name', '1', 'Customer_Name']);
    expect(templateTokens(headerText: 'Hello {{1}}', bodyText: 'Dear {{2}}, {{1}} again'), ['1', '2']);
  });

  test('auto-mapping: named by name, positional from the unclaimed sheet columns, in order', () {
    expect(autoMap(['customer_name', 'city', 'company_name', 'unknown'], fields: contactFields, attributeKeys: ['City', 'Customer Name']), {
      'customer_name': const VarSource.attribute('Customer Name'),
      'city': const VarSource.attribute('City'),
      // As the JS does: "name" is checked before "company" for a partial match.
      'company_name': const VarSource.field('name'),
    });
    expect(autoMap(['2', '1', 'city'], fields: ['name'], attributeKeys: ['city', 'amount', 'date']), {
      '1': const VarSource.attribute('amount'),
      '2': const VarSource.attribute('date'),
      'city': const VarSource.attribute('city'),
    });
  });

  test('rendering fills values, flattens whitespace, and leaves gaps visible', () {
    const asha = WaContact(id: 1, phone: '919800000001', name: 'Asha', attributes: {'item': 'order'});
    expect(
      renderTemplateText('Hi {{name}}, your {{1}} is {{2}}', {
        'name': const VarSource.field('name'),
        '1': const VarSource.attribute('item'),
        '2': const VarSource.literal('  ready\n now '),
      }, asha),
      'Hi Asha, your order is ready now',
    );
    expect(renderTemplateText('Hi {{name}} {{x}}', {'name': const VarSource.attribute('missing')}, asha), 'Hi {{name}} {{x}}');
    expect(sanitizeParam('  a\t\tb\n\nc    d '), 'a b c d');
  });

  test('missing values are caught per person', () {
    const blank = WaContact(id: 2, phone: '919800000002');
    expect(isMissing('a', {}, blank), isTrue);
    expect(isMissing('a', {'a': const VarSource.field('email')}, blank), isTrue);
    expect(isMissing('a', {'a': const VarSource.literal(' x ')}, blank), isFalse);
  });

  test('a header file is a media id or a clean https link, nothing else', () {
    expect(
      [
        '1234567',
        'https://example.com/v.mp4',
        'http://example.com/v.mp4',
        'https://user:pw@example.com/a',
        'ftp://x',
        '',
        'javascript:alert(1)',
        '12ab',
      ].map(parseHeaderMedia).toList(),
      ['1234567', 'https://example.com/v.mp4', null, null, null, null, null, null],
    );
    expect(mediaHeaderFormat('video'), 'VIDEO');
    expect(mediaHeaderFormat('TEXT'), isNull);
  });

  test('a variable source serialises as the server stores it', () {
    expect(const VarSource.field('name').toJson(), {'source': 'field', 'key': 'name'});
    expect(const VarSource.literal('Hi').toJson(), {'source': 'literal', 'value': 'Hi'});
    expect(const VarSource.media('123').toJson(), {'source': 'media', 'value': '123'});
  });
}
