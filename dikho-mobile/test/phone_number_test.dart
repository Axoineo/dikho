import 'package:dikho_crm/features/device_contacts/phone_number.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Indian numbers as people save them', () {
    for (final raw in ['9800000001', '98000 00001', '098000-00001', '(98000) 00001', '+91 98000 00001', '+919800000001', '919800000001', '00919800000001']) {
      expect(normalizePhoneNumber(raw), '+919800000001', reason: raw);
    }
  });

  test('other countries keep their own code', () {
    expect(normalizePhoneNumber('+1 (415) 555-2671'), '+14155552671');
    expect(normalizePhoneNumber('+44 7911 123456'), '+447911123456');
    expect(normalizePhoneNumber('0044 7911 123456'), '+447911123456');
  });

  test('anything that is not a reachable number is dropped', () {
    for (final raw in ['', 'abc', '123', '121', '+12', '1800-11', '+1234567890123456', '98000']) {
      expect(normalizePhoneNumber(raw), isNull, reason: raw);
    }
  });

  test('display', () {
    expect(formatPhoneNumber('+919800000001'), '+91 98000 00001');
    expect(formatPhoneNumber('+14155552671'), '+14155552671');
  });

  test('entries with no number go, and the same number saved twice appears once', () {
    final contacts = parseDeviceContacts([
      'Asha', '98000 00001',
      'Asha', '+91 98000 00001',
      'Asha', '98000 00002',
      'No Number', 'n/a',
      'Bilal', '98000 00003',
      '', '98000 00004',
    ]);
    expect(contacts.map((c) => '${c.name}:${c.number}'), [
      'Asha:+919800000001',
      'Asha:+919800000002',
      'Bilal:+919800000003',
      ':+919800000004',
    ]);
    expect(contacts.last.label, '+91 98000 00004');
    expect(contacts.last.initials, '#');
  });

  test('a trailing name with no number does not crash', () {
    expect(parseDeviceContacts(['Asha']), isEmpty);
  });

  test('search by name or number, however the number is typed', () {
    final contacts = parseDeviceContacts(['Asha Rao', '98000 00001', 'Bilal', '98000 00002']);
    expect(filterDeviceContacts(contacts, 'asha').map((c) => c.name), ['Asha Rao']);
    expect(filterDeviceContacts(contacts, 'RAO').map((c) => c.name), ['Asha Rao']);
    expect(filterDeviceContacts(contacts, '00002').map((c) => c.name), ['Bilal']);
    expect(filterDeviceContacts(contacts, '98000 00002').map((c) => c.name), ['Bilal']);
    expect(filterDeviceContacts(contacts, '+91 98000 00001').map((c) => c.name), ['Asha Rao']);
    expect(filterDeviceContacts(contacts, '').length, 2);
    expect(filterDeviceContacts(contacts, 'nobody'), isEmpty);
  });

  test('5,000 contacts parse quickly', () {
    final flat = <String>[for (var i = 0; i < 5000; i++) ...['Person $i', '98${i.toString().padLeft(8, '0')}']];
    final watch = Stopwatch()..start();
    final contacts = parseDeviceContacts(flat);
    expect(contacts.length, 5000);
    expect(watch.elapsedMilliseconds, lessThan(1000));
  });
}
