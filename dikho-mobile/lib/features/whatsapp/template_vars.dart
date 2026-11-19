/// Template variables ({{...}}), ported from src/lib/templateVars.js, which the web
/// wizard and the send path on the server share. The server builds what Meta receives
/// from the variable map; this copy only drives the app's choices, preview and checks,
/// so it must read a map exactly as the server does. Keep the two in step.
library;

import 'contacts_models.dart';

final tokenPattern = RegExp(r'\{\{\s*([\w.\- ]+?)\s*\}\}');

/// Ordered, de-duplicated tokens inside a template string.
List<String> extractTokens(String? text) {
  final tokens = <String>[];
  for (final match in tokenPattern.allMatches(text ?? '')) {
    final token = match[1]!.trim();
    if (token.isNotEmpty && !tokens.contains(token)) tokens.add(token);
  }
  return tokens;
}

/// Every distinct token across a template's header and body.
List<String> templateTokens({String? headerText, String? bodyText}) {
  final merged = <String>[];
  for (final token in [...extractTokens(headerText), ...extractTokens(bodyText)]) {
    if (!merged.contains(token)) merged.add(token);
  }
  return merged;
}

bool isPositional(String token) => RegExp(r'^\d+$').hasMatch(token);

/// Lowercase letters and digits only: "Send List - Name" matches "sendlistname".
String normalizeKey(String? value) => (value ?? '').toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

/// Standard contact fields usable as a variable source.
const contactFields = ['name', 'company', 'email', 'phone'];

/// Where one variable's value comes from, in the shape the server stores and reads.
class VarSource {
  const VarSource.field(String this.key) : source = 'field', value = null;
  const VarSource.attribute(String this.key) : source = 'attribute', value = null;
  const VarSource.literal(String this.value) : source = 'literal', key = null;
  const VarSource.media(String this.value) : source = 'media', key = null;

  final String source;
  final String? key;
  final String? value;

  Map<String, Object?> toJson() => {'source': source, 'key': ?key, 'value': ?value};

  @override
  bool operator ==(Object other) => other is VarSource && other.source == source && other.key == key && other.value == value;

  @override
  int get hashCode => Object.hash(source, key, value);
}

/// The header file's key in the map. `@` cannot appear in a {{token}}, so it never
/// collides with one.
const headerMediaKey = '@header';

/// Best guess for one named token; null for positional ones, which go by order.
VarSource? guessSource(String token, {List<String> fields = contactFields, List<String> attributeKeys = const []}) {
  if (isPositional(token)) return null;
  final target = normalizeKey(token);
  for (final key in attributeKeys) {
    if (normalizeKey(key) == target) return VarSource.attribute(key);
  }
  for (final field in fields) {
    if (normalizeKey(field) == target) return VarSource.field(field);
  }
  for (final key in attributeKeys) {
    final norm = normalizeKey(key);
    if (norm.isNotEmpty && (norm.contains(target) || target.contains(norm))) return VarSource.attribute(key);
  }
  for (final field in fields) {
    final norm = normalizeKey(field);
    if (norm.contains(target) || target.contains(norm)) return VarSource.field(field);
  }
  return null;
}

/// Named tokens match by name; positional ones then take, in order, the sheet columns
/// no named token claimed.
Map<String, VarSource> autoMap(List<String> tokens, {List<String> fields = contactFields, List<String> attributeKeys = const []}) {
  final map = <String, VarSource>{};
  final claimed = <String>{};
  for (final token in tokens.where((t) => !isPositional(t))) {
    final guess = guessSource(token, fields: fields, attributeKeys: attributeKeys);
    if (guess != null) {
      map[token] = guess;
      if (guess.source == 'attribute') claimed.add(guess.key!);
    }
  }
  final spare = attributeKeys.where((key) => !claimed.contains(key)).toList();
  var cursor = 0;
  final positional = tokens.where(isPositional).toList()..sort((a, b) => int.parse(a).compareTo(int.parse(b)));
  for (final token in positional) {
    if (cursor < spare.length) map[token] = VarSource.attribute(spare[cursor++]);
  }
  return map;
}

String _fieldOf(WaContact contact, String key) => switch (key) {
  'name' => contact.name,
  'company' => contact.company,
  'email' => contact.email,
  'phone' => contact.phone,
  _ => '',
};

String _resolveRaw(VarSource? entry, WaContact? contact) {
  if (entry == null) return '';
  if (entry.source == 'literal') return entry.value ?? '';
  if (contact == null) return '';
  if (entry.source == 'field') return _fieldOf(contact, entry.key ?? '');
  if (entry.source == 'attribute') return contact.attributes[entry.key] ?? '';
  return '';
}

/// Meta refuses parameters with newlines, tabs or runs of spaces.
String sanitizeParam(String? text) => (text ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();

/// True when a token has no usable value for this contact.
bool isMissing(String token, Map<String, VarSource> map, WaContact? contact) {
  final entry = map[token];
  if (entry == null) return true;
  return sanitizeParam(_resolveRaw(entry, contact)).isEmpty;
}

/// The text with each token filled in for one contact; gaps stay as {{token}}.
String renderTemplateText(String? text, Map<String, VarSource> map, WaContact? contact) => (text ?? '').replaceAllMapped(tokenPattern, (match) {
  final value = sanitizeParam(_resolveRaw(map[match[1]!.trim()], contact));
  return value.isEmpty ? match[0]! : value;
});

/* ── Media headers ───────────────────────────────────────────────────── */

const mediaHeaderFormats = ['IMAGE', 'VIDEO', 'DOCUMENT'];

/// IMAGE, VIDEO or DOCUMENT when the template's header needs a file, else null.
String? mediaHeaderFormat(String? headerFormat) {
  final format = (headerFormat ?? '').toUpperCase();
  return mediaHeaderFormats.contains(format) ? format : null;
}

/// A media ID (digits) or an https link without credentials, at most 2048 characters;
/// null for anything else. Meta fetches the link, the app never does.
String? parseHeaderMedia(String? input) {
  final value = (input ?? '').trim();
  if (RegExp(r'^\d{1,32}$').hasMatch(value)) return value;
  if (value.isEmpty || value.length > 2048) return null;
  final uri = Uri.tryParse(value);
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty || uri.userInfo.isNotEmpty) return null;
  return uri.toString();
}

/// What the header upload accepts, as the API's own rules (it checks again).
class MediaRule {
  const MediaRule(this.noun, this.types, this.maxBytes, this.hint);
  final String noun;
  final List<String> types;
  final int maxBytes;
  final String hint;
}

const mediaRules = {
  'IMAGE': MediaRule('photo', ['image/jpeg', 'image/png'], 5 * 1024 * 1024, 'JPEG or PNG, up to 5 MB.'),
  'VIDEO': MediaRule('video', ['video/mp4', 'video/3gpp'], 16 * 1024 * 1024, 'MP4 (H.264 video, AAC audio), up to 16 MB.'),
  'DOCUMENT': MediaRule('document', ['application/pdf'], 16 * 1024 * 1024, 'PDF, up to 16 MB.'),
};
