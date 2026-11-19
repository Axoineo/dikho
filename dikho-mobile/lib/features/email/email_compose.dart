import 'dart:math';

import 'email_models.dart';

/// The composer's rules, as Composer.jsx has them: who a reply goes to, the subject's
/// "Re:" or "Fwd:", the quoted original, and the limits on attachments.

const maxAttachments = 10;
const maxAttachmentBytes = 15 * 1024 * 1024;

final emailPattern = RegExp(r'^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$');

String escapeHtml(String text) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/// "Re: " or "Fwd: " once, never stacked.
String prefixed(String prefix, String subject) {
  final clean = subject.trim();
  return RegExp('^$prefix:\\s', caseSensitive: false).hasMatch(clean) ? clean : '$prefix: $clean'.trim();
}

/// Who a reply starts with. The mailbox's own address is never one of them.
({List<Person> to, List<Person> cc}) replyRecipients(EmailMessage source, String mode, String own) {
  bool keep(Person p) => p.email.isNotEmpty && p.email.toLowerCase() != own.toLowerCase();
  final fromIsMe = source.from.email.toLowerCase() == own.toLowerCase();
  final primary = fromIsMe ? source.to : (source.replyTo.isNotEmpty ? source.replyTo : [source.from]);
  final to = primary.where(keep).toList();
  if (mode != 'reply_all') return (to: to, cc: const []);
  final seen = {for (final p in to) p.email.toLowerCase()};
  List<Person> more(List<Person> list) => [
    for (final p in list)
      if (keep(p) && seen.add(p.email.toLowerCase())) p,
  ];
  return (to: [...to, if (!fromIsMe) ...more(source.to)], cc: more(source.cc));
}

/// The original under a reply or forward, as HTML. The source's HTML is the server's
/// sanitized copy; plain text is escaped.
String quoteBlock(EmailMessage source, String mode) {
  final body = source.html.isNotEmpty ? source.html : '<div style="white-space:pre-wrap">${escapeHtml(source.text)}</div>';
  if (mode == 'forward') {
    return '<br><br><div>---------- Forwarded message ---------<br>From: ${escapeHtml(source.from.display)} &lt;${escapeHtml(source.from.email)}&gt;<br>'
        'Date: ${escapeHtml(fullTime(source.date))}<br>Subject: ${escapeHtml(source.subject)}<br>To: ${escapeHtml(addressList(source.to))}</div><br>$body';
  }
  return '<br><br><div>On ${escapeHtml(fullTime(source.date))}, ${escapeHtml(source.from.display)} wrote:</div><blockquote>$body</blockquote>';
}

/// What is typed, as HTML: escaped, line breaks kept; then a signature and the quote.
String messageHtml(String typed, {String signature = '', String quote = ''}) {
  final text = escapeHtml(typed).replaceAll('\r\n', '\n').replaceAll('\n', '<br>');
  final sign = signature.isEmpty ? '' : '<br><br><div>$signature</div>';
  return '<div>$text</div>$sign$quote';
}

/// How a recipient goes in the form: `"Asha Rao" <asha@example.com>`.
String joinRecipients(List<Person> people) =>
    people.map((p) => p.name.isNotEmpty ? '"${p.name.replaceAll('"', '')}" <${p.email}>' : p.email).join(', ');

/// `asha@example.com` or `Asha <asha@example.com>` typed
/// into a field, as a person; null when it holds no address.
Person? parseRecipient(String raw) {
  final text = raw.trim().replaceAll(RegExp(r'[,;]$'), '');
  if (text.isEmpty) return null;
  final angled = RegExp(r'^(.*)<([^>]+)>$').firstMatch(text);
  if (angled != null) return Person(angled.group(1)!.replaceAll('"', '').trim(), angled.group(2)!.trim().toLowerCase());
  return Person('', text.toLowerCase());
}

final _random = Random.secure();

/// One id per message, so a send repeated after a dropped connection goes once.
String newSendId() {
  String hex(int n) => List.generate(n, (_) => _random.nextInt(16).toRadixString(16)).join();
  final variant = (8 + _random.nextInt(4)).toRadixString(16);
  return '${hex(8)}-${hex(4)}-4${hex(3)}-$variant${hex(3)}-${hex(12)}';
}
