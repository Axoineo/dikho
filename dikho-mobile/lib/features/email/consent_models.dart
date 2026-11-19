import 'email_models.dart' show fullTime;

/// How a consent change came about, as CONSENT_SOURCES in emailFormat.js.
const consentSources = {
  'form': 'Signed up on a form',
  'verbal': 'Agreed verbally',
  'written': 'Agreed in writing',
  'imported': 'Imported with consent records',
  'request': 'At their request',
  'unsubscribe_link': 'Unsubscribe link',
  'complaint': 'Marked as spam',
};

/// The ways staff may record that someone agreed. em_set_preference refuses any other.
const recordableSources = ['form', 'verbal', 'written', 'imported'];

final _address = RegExp(r'^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$');

/// The address as the server keys it (trimmed, lower case), or null when it is not a
/// full email address. The same rule as EmailConsent.jsx.
String? lookupAddress(String text) {
  final email = text.trim().toLowerCase();
  return _address.hasMatch(email) ? email : null;
}

enum ConsentTone { agreed, stopped, suppressed, none }

/// One address's marketing consent and suppression, as em_preference_json returns it.
/// There is no list of everyone on purpose: staff look up the person they deal with.
class ConsentRecord {
  ConsentRecord(Map<String, dynamic> raw)
    : email = _text(raw['email']),
      marketing = raw['marketing'] is String ? raw['marketing'] as String : null,
      source = _text(raw['marketing_source']),
      note = _text(raw['marketing_note']),
      changedAt = _text(raw['marketing_changed_at']),
      changedByName = _text(raw['marketing_changed_by_name']),
      suppressed = raw['suppressed'] == true,
      suppressedReason = _text(raw['suppressed_reason']),
      suppressedAt = _text(raw['suppressed_at']);

  final String email;

  /// subscribed, unsubscribed, or null when nothing is recorded.
  final String? marketing;
  final String source;
  final String note;
  final String changedAt;
  final String changedByName;
  final bool suppressed;

  /// hard_bounce or manual.
  final String suppressedReason;
  final String suppressedAt;

  bool get subscribed => marketing == 'subscribed';
  bool get unsubscribed => marketing == 'unsubscribed';

  String get marketingLabel => subscribed
      ? 'Subscribed'
      : unsubscribed
      ? 'Unsubscribed'
      : 'Not recorded';

  /// The headline: its tone, title and line under it.
  (ConsentTone, String, String) get state {
    if (suppressed) {
      return (
        ConsentTone.suppressed,
        'Suppressed: no email is sent',
        suppressedReason == 'hard_bounce' ? 'The address bounced permanently.' : 'Suppressed by staff.',
      );
    }
    if (subscribed) return (ConsentTone.agreed, 'Agreed to marketing email', consentSources[source] ?? '');
    if (unsubscribed) return (ConsentTone.stopped, 'Unsubscribed', consentSources[source] ?? '');
    return (ConsentTone.none, 'No consent recorded', 'Campaigns are not sent to this address.');
  }

  /// "When, by whom", or empty when nothing was recorded.
  String get recorded {
    if (changedAt.isEmpty) return '';
    return changedByName.isEmpty ? fullTime(changedAt) : '${fullTime(changedAt)} by $changedByName';
  }

  String get suppressedLabel => suppressed ? (suppressedAt.isEmpty ? 'Yes' : 'Yes, since ${fullTime(suppressedAt)}') : 'No';
}

String _text(Object? value) => value is String ? value : '';
