/// What the WhatsApp screens read from the API, kept in step with
/// src/features/whatsapp/WhatsAppTemplates.jsx.
library;

/// One template, as GET /api/templates lists it.
class TemplateInfo {
  TemplateInfo(this.raw);

  final Map<String, dynamic> raw;

  String _text(String key) => raw[key] is String ? raw[key] as String : '';

  String get name => _text('name');
  String get language => _text('language');
  String get category => _text('category');
  String get status => _text('status');
  String get headerText => _text('headerText');
  String get bodyText => _text('bodyText');
  String get footerText => _text('footerText');
  String? get headerFormat => raw['headerFormat'] is String ? raw['headerFormat'] as String : null;

  bool get hasVariables {
    final flag = raw['hasVariables'];
    if (flag is bool) return flag;
    return RegExp(r'\{\{').hasMatch('$headerText$bodyText');
  }

  /// "Photo", "Video" or "Document" for a media header, else null.
  String? get mediaLabel => switch (headerFormat) {
    'IMAGE' => 'Photo',
    'VIDEO' => 'Video',
    'DOCUMENT' => 'Document',
    _ => null,
  };

  List<String> get buttons => [
    for (final button in raw['buttons'] as List? ?? const [])
      if (button is Map && button['text'] is String && (button['text'] as String).trim().isNotEmpty) (button['text'] as String).trim(),
  ];

  String get key => '$name-$language';
}

class TemplateList {
  const TemplateList({required this.templates, required this.fallback});

  final List<TemplateInfo> templates;

  /// The API could not reach Meta and listed its built-in stand-in instead.
  final bool fallback;

  factory TemplateList.from(Map<String, dynamic> data) => TemplateList(
    templates: [
      for (final row in data['templates'] as List? ?? const [])
        if (row is Map<String, dynamic>) TemplateInfo(row),
    ],
    fallback: data['source'] == 'fallback',
  );
}
