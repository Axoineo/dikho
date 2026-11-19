import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import 'chat_theme.dart';

/// Forms for the WhatsApp message kinds beyond text and files. The limits shown are
/// Meta's, and the API checks the same ones, so the counters only spare a round trip.
const composeTitles = {
  'location': 'Send a location',
  'contact': 'Send a contact',
  'buttons': 'Message with reply buttons',
  'list': 'Message with a list',
  'cta_url': 'Message with a link button',
  'location_request': 'Ask for their location',
  'address': 'Ask for a delivery address',
};

Future<void> showComposeSheet(
  BuildContext context, {
  required String kind,
  required String recipient,
  required Future<void> Function(Map<String, Object?> input) onSend,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (_) => ComposeSheet(kind: kind, recipient: recipient, onSend: onSend),
);

class ComposeSheet extends StatefulWidget {
  const ComposeSheet({super.key, required this.kind, required this.recipient, required this.onSend});

  final String kind;
  final String recipient;
  final Future<void> Function(Map<String, Object?> input) onSend;

  @override
  State<ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<ComposeSheet> {
  final _fields = <String, TextEditingController>{};
  int _optionRows = 1;
  bool _sending = false;
  String? _error;

  static const _defaults = {'location_request': 'Could you share your location, please?', 'address': 'Please share your delivery address.'};

  TextEditingController _c(String key) => _fields.putIfAbsent(key, () {
    final initial = key == 'body' ? _defaults[widget.kind] ?? '' : '';
    return TextEditingController(text: initial)..addListener(() => setState(() {}));
  });

  String _v(String key) => _c(key).text.trim();

  @override
  void dispose() {
    for (final field in _fields.values) {
      field.dispose();
    }
    super.dispose();
  }

  static final _atCoords = RegExp(r'@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)');
  static final _queryCoords = RegExp(r'[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)');

  void _fillFromLink(String link) {
    final match = _atCoords.firstMatch(link) ?? _queryCoords.firstMatch(link);
    if (match == null) return;
    _c('latitude').text = match.group(1)!;
    _c('longitude').text = match.group(2)!;
  }

  bool get _ready {
    if (_sending) return false;
    switch (widget.kind) {
      case 'location':
        return double.tryParse(_v('latitude')) != null && double.tryParse(_v('longitude')) != null;
      case 'contact':
        return _v('name').isNotEmpty && _v('phone').isNotEmpty;
      case 'buttons':
        return _v('body').isNotEmpty && _v('button0').isNotEmpty;
      case 'list':
        return _v('body').isNotEmpty && _v('button').isNotEmpty && _v('row0').isNotEmpty;
      case 'cta_url':
        return _v('body').isNotEmpty && _v('label').isNotEmpty && _v('url').isNotEmpty;
      default:
        return _v('body').isNotEmpty;
    }
  }

  Map<String, Object?> _request() {
    switch (widget.kind) {
      case 'location':
        return {'latitude': double.parse(_v('latitude')), 'longitude': double.parse(_v('longitude')), 'name': _v('name'), 'address': _v('address')};
      case 'contact':
        return {'name': _v('name'), 'phone': _v('phone'), 'email': _v('email'), 'company': _v('company')};
      case 'buttons':
        return {
          'header': _v('header'),
          'body': _v('body'),
          'footer': _v('footer'),
          'buttons': [
            for (var i = 0; i < 3; i++)
              if (_v('button$i').isNotEmpty) _v('button$i'),
          ],
        };
      case 'list':
        return {
          'header': _v('header'),
          'body': _v('body'),
          'footer': _v('footer'),
          'button': _v('button'),
          'sections': [
            {
              'title': _v('sectionTitle'),
              'rows': [
                for (var i = 0; i < _optionRows; i++)
                  if (_v('row$i').isNotEmpty) {'title': _v('row$i'), 'description': _v('desc$i')},
              ],
            },
          ],
        };
      case 'cta_url':
        return {'header': _v('header'), 'body': _v('body'), 'footer': _v('footer'), 'label': _v('label'), 'url': _v('url')};
      default:
        return {'body': _v('body')};
    }
  }

  Future<void> _send() async {
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await widget.onSend(_request());
      if (mounted) Navigator.of(context).pop();
    } on Exception catch (error) {
      if (mounted) {
        setState(() {
          _sending = false;
          _error = friendlyError(error);
        });
      }
    }
  }

  Widget _field(
    String key,
    String label, {
    bool required = false,
    int? max,
    int lines = 1,
    TextInputType? keyboard,
    String? helper,
    ValueChanged<String>? onChanged,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: TextField(
      controller: _c(key),
      enabled: !_sending,
      maxLength: max,
      minLines: lines,
      maxLines: lines == 1 ? 1 : 6,
      keyboardType: keyboard,
      onChanged: onChanged,
      decoration: InputDecoration(labelText: required ? label : '$label (optional)', helperText: helper, helperMaxLines: 3),
    ),
  );

  List<Widget> _decorations({int bodyMax = 1024}) => [
    _field('header', 'Header', max: 60),
    _field('body', 'Message', required: true, max: bodyMax, lines: 3),
    _field('footer', 'Footer', max: 60),
  ];

  List<Widget> _form() {
    switch (widget.kind) {
      case 'location':
        return [
          _field(
            'link',
            'Google Maps link',
            helper: 'Paste a link and the coordinates fill in.',
            keyboard: TextInputType.url,
            onChanged: _fillFromLink,
          ),
          _field('latitude', 'Latitude', required: true, keyboard: const TextInputType.numberWithOptions(signed: true, decimal: true)),
          _field('longitude', 'Longitude', required: true, keyboard: const TextInputType.numberWithOptions(signed: true, decimal: true)),
          _field('name', 'Place name', max: 100),
          _field('address', 'Address', max: 300),
        ];
      case 'contact':
        return [
          _field('name', 'Name', required: true, max: 100),
          _field('phone', 'Phone number', required: true, max: 30, keyboard: TextInputType.phone),
          _field('email', 'Email', max: 120, keyboard: TextInputType.emailAddress),
          _field('company', 'Company', max: 100),
        ];
      case 'buttons':
        return [..._decorations(), for (var i = 0; i < 3; i++) _field('button$i', 'Button ${i + 1}', required: i == 0, max: 20)];
      case 'list':
        return [
          ..._decorations(bodyMax: 4096),
          _field('button', 'List button label', required: true, max: 20),
          _field('sectionTitle', 'Section title', max: 24),
          for (var i = 0; i < _optionRows; i++) ...[
            _field('row$i', 'Option ${i + 1}', required: i == 0, max: 24),
            _field('desc$i', 'Description', max: 72),
          ],
          if (_optionRows < 10)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _sending ? null : () => setState(() => _optionRows++),
                icon: const Icon(Icons.add),
                label: const Text('Add an option'),
              ),
            ),
        ];
      case 'cta_url':
        return [
          ..._decorations(),
          _field('label', 'Button label', required: true, max: 20),
          _field('url', 'Link', required: true, keyboard: TextInputType.url),
        ];
      case 'location_request':
        return [
          _field('body', 'Message', required: true, max: 1024, lines: 3, helper: 'They get a Send location button. Their pin arrives in this chat.'),
        ];
      case 'address':
        return [
          _field(
            'body',
            'Message',
            required: true,
            max: 1024,
            lines: 3,
            helper: 'They get a form for a delivery address in India, which arrives in this chat when they send it.',
          ),
        ];
      default:
        return const [];
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.85),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.m),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(composeTitles[widget.kind] ?? 'Send', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 2),
                  Text(
                    'To ${widget.recipient}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            const Divider(),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, Gap.s),
                children: [
                  ..._form(),
                  if (_error != null)
                    Container(
                      padding: const EdgeInsets.all(Gap.m),
                      decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
                      child: Text(_error!, style: TextStyle(color: theme.colorScheme.onErrorContainer)),
                    ),
                ],
              ),
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.all(Gap.m),
              child: FilledButton(onPressed: _ready ? () => unawaited(_send()) : null, child: Text(_sending ? 'Sending…' : 'Send')),
            ),
          ],
        ),
      ),
    );
  }
}
