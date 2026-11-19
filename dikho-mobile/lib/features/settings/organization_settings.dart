import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../inbox/chat_theme.dart';
import 'settings_controller.dart';
import 'settings_models.dart';
import 'settings_parts.dart';

/// The "Organization" screens: Company, Regional, Lists and media, as
/// OrganizationSettings.jsx. They change what everyone sees, so only people with
/// settings.manage reach them, and the database checks that again on every save.

/// Capitals, no spaces: GSTIN, PAN and IFSC are typed however the keyboard likes.
class _UpperNoSpaces extends TextInputFormatter {
  const _UpperNoSpaces();

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final text = newValue.text.toUpperCase().replaceAll(RegExp(r'\s'), '');
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}

bool _notReady(ApiException failure) => failure.code == 'PGRST202' || failure.status == 404;

/* ── Company ──────────────────────────────────────────────────────────────── */

class CompanySettingsScreen extends StatefulWidget {
  const CompanySettingsScreen({super.key, required this.controller});

  final SettingsController controller;

  @override
  State<CompanySettingsScreen> createState() => _CompanySettingsScreenState();
}

class _CompanySettingsScreenState extends State<CompanySettingsScreen> {
  Map<String, String>? _saved;
  Map<String, String>? _form;
  ApiException? _loadError;
  Map<String, String> _problems = {};
  String? _saveError;
  bool _busy = false;
  final _fields = <String, TextEditingController>{};
  final _focus = <String, FocusNode>{};

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final c in _fields.values) {
      c.dispose();
    }
    for (final f in _focus.values) {
      f.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      _use(await widget.controller.loadCompany());
    } on ApiException catch (failure) {
      if (mounted) setState(() => _loadError = failure);
    }
  }

  void _use(Map<String, String> fresh) {
    if (!mounted) return;
    setState(() {
      _saved = fresh;
      _form = {...fresh};
      _problems = {};
      _saveError = null;
    });
    for (final key in companyFields) {
      _fields[key]?.text = fresh[key] ?? '';
    }
  }

  bool get _dirty {
    final saved = _saved;
    final form = _form;
    return saved != null && form != null && companyChanges(saved, form).isNotEmpty;
  }

  Future<void> _save() async {
    final form = _form!;
    final found = companyProblems(form);
    setState(() {
      _problems = found;
      _saveError = null;
    });
    if (found.isNotEmpty) {
      _focus[found.keys.first]?.requestFocus();
      return;
    }
    setState(() => _busy = true);
    try {
      final fresh = await widget.controller.saveCompany(companyChanges(_saved!, form));
      _use(fresh);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Company details saved')));
    } on ApiException catch (failure) {
      if (mounted) setState(() => _saveError = failure.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _cancel() {
    final saved = _saved!;
    _use(saved);
  }

  Future<void> _leave() async {
    if (!_dirty || await confirmDiscard(context)) {
      if (mounted) Navigator.of(context).pop();
    }
  }

  Widget _field(
    String key,
    String label, {
    bool required = false,
    bool optional = false,
    String? helper,
    TextInputType? keyboard,
    List<TextInputFormatter>? formatters,
    TextCapitalization caps = TextCapitalization.none,
    int? maxLength,
  }) {
    final controller = _fields.putIfAbsent(key, () => TextEditingController(text: _form![key]));
    final focus = _focus.putIfAbsent(key, FocusNode.new);
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.m),
      child: TextField(
        controller: controller,
        focusNode: focus,
        keyboardType: keyboard,
        inputFormatters: [...?formatters, if (maxLength != null) LengthLimitingTextInputFormatter(maxLength)],
        textCapitalization: caps,
        onChanged: (value) => setState(() {
          _form![key] = value;
          _problems = {..._problems}..remove(key);
        }),
        decoration: InputDecoration(
          labelText: required ? '$label *' : (optional ? '$label (optional)' : label),
          errorText: _problems[key],
          helperText: helper,
          helperMaxLines: 2,
          errorMaxLines: 3,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final failure = _loadError;
    final form = _form;
    Widget body;
    if (failure != null) {
      body = ListView(
        padding: const EdgeInsets.all(Gap.l),
        children: [
          if (_notReady(failure))
            const NotReadyNote()
          else ...[
            StatusText(text: failure.message, error: true),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(onPressed: () => unawaited(_load()), child: const Text('Try again')),
            ),
          ],
        ],
      );
    } else if (form == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      final derived = derivedStateCode(form);
      final upper = [const _UpperNoSpaces()];
      final digits = [FilteringTextInputFormatter.digitsOnly];
      body = ListView(
        padding: const EdgeInsets.all(Gap.l),
        children: [
          const SettingsIntro('The business details printed on tax invoices, and where customers pay you.'),
          if (_problems.isNotEmpty) StatusText(text: 'Some fields need attention. They are marked below.', error: true),
          // Keyed: the line above comes and goes, and the fields must keep their state.
          SettingsGroup(
            key: const ValueKey('business'),
            title: 'Business details',
            description: 'Invoices already issued keep the details they were issued with.',
            children: [
              _field('legal_name', 'Legal name', required: true, caps: TextCapitalization.words, maxLength: 200),
              _field('gstin', 'GSTIN', formatters: upper, maxLength: 15, caps: TextCapitalization.characters),
              _field('pan', 'PAN', formatters: upper, maxLength: 10, caps: TextCapitalization.characters),
              if (derived != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: Gap.m),
                  child: InputDecorator(
                    decoration: const InputDecoration(labelText: 'GST state code', helperText: 'Taken from the GSTIN.'),
                    child: Text(derived),
                  ),
                )
              else
                _field(
                  'state_code',
                  'GST state code',
                  required: true,
                  keyboard: TextInputType.number,
                  formatters: digits,
                  maxLength: 2,
                  helper: 'Two digits; filled in by itself once you enter a GSTIN.',
                ),
              _field('address_line1', 'Address', required: true, caps: TextCapitalization.words, maxLength: 200),
              _field('address_line2', 'Address line 2', optional: true, caps: TextCapitalization.words, maxLength: 200),
              _field('city', 'City', required: true, caps: TextCapitalization.words, maxLength: 200),
              _field('state', 'State', required: true, caps: TextCapitalization.words, maxLength: 200),
              _field(
                'pincode',
                'PIN code',
                required: true,
                keyboard: (form['country'] ?? 'India') == 'India' ? TextInputType.number : TextInputType.text,
                formatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9A-Za-z -]'))],
                maxLength: 10,
              ),
              _field('country', 'Country', caps: TextCapitalization.words, maxLength: 80),
            ],
          ),
          SettingsGroup(
            key: const ValueKey('bank'),
            title: 'Bank account',
            description: 'Printed on invoices so customers know where to pay.',
            children: [
              _field('bank_name', 'Bank', caps: TextCapitalization.words, maxLength: 200),
              _field('bank_branch', 'Branch', optional: true, caps: TextCapitalization.words, maxLength: 200),
              _field('bank_account_name', 'Account holder', caps: TextCapitalization.words, maxLength: 200),
              _field('bank_account_number', 'Account number', keyboard: TextInputType.number, formatters: digits, maxLength: 18),
              _field('bank_ifsc', 'IFSC', formatters: upper, maxLength: 11, caps: TextCapitalization.characters),
            ],
          ),
          if (_saveError != null)
            Container(
              padding: const EdgeInsets.all(Gap.m),
              decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
              child: Semantics(
                liveRegion: true,
                child: Text('Could not save. $_saveError', style: TextStyle(color: theme.colorScheme.onErrorContainer)),
              ),
            ),
        ],
      );
    }
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Company')),
        body: body,
        bottomNavigationBar: _dirty ? SaveBar(busy: _busy, onSave: () => unawaited(_save()), onCancel: _cancel) : null,
      ),
    );
  }
}

/* ── Regional ─────────────────────────────────────────────────────────────── */

class RegionalSettingsScreen extends StatefulWidget {
  const RegionalSettingsScreen({super.key, required this.controller, this.today});

  final SettingsController controller;

  /// For tests; else the day it opens.
  final DateTime? today;

  @override
  State<RegionalSettingsScreen> createState() => _RegionalSettingsScreenState();
}

class _RegionalSettingsScreenState extends State<RegionalSettingsScreen> {
  Regional? _form;
  bool _busy = false;
  String? _status;
  bool _error = false;
  late final DateTime _today = widget.today ?? DateTime.now();

  SettingsController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    unawaited(_c.loadSettings());
  }

  Future<void> _save(Regional value) async {
    setState(() {
      _busy = true;
      _status = null;
    });
    try {
      await _c.saveRegional(value);
      if (!mounted) return;
      setState(() {
        _form = null;
        _status = 'Saved. Everyone else sees it the next time they open Dikho.';
        _error = false;
      });
    } on ApiException catch (failure) {
      if (mounted) {
        setState(() {
          _status = failure.message;
          _error = true;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final theme = Theme.of(context);
      final saved = _c.regional;
      final form = _form ?? saved;
      final dirty = _form != null && _form != saved;
      Widget body;
      if (!_c.settingsLoaded) {
        body = const Center(child: CircularProgressIndicator());
      } else if (_c.notReady) {
        body = ListView(padding: const EdgeInsets.all(Gap.l), children: const [NotReadyNote()]);
      } else {
        body = ListView(
          padding: const EdgeInsets.all(Gap.l),
          children: [
            const SettingsIntro("How dates and amounts appear on everyone's screens. Exports and invoices are not affected."),
            if (_c.settingsError != null) StatusText(text: _c.settingsError, error: true),
            SettingsGroup(
              title: 'Date format',
              description: 'Today reads ${formatDayAs(form.dateFormat, _today)}.',
              children: [
                RadioGroup<String>(
                  groupValue: form.dateFormat,
                  onChanged: (value) {
                    if (value != null) setState(() => _form = form.copyWith(dateFormat: value));
                  },
                  child: Column(
                    children: [
                      for (final format in dateFormats)
                        RadioListTile<String>(contentPadding: EdgeInsets.zero, value: format, title: Text(formatDayAs(format, _today))),
                    ],
                  ),
                ),
              ],
            ),
            SettingsGroup(
              title: 'Number style',
              children: [
                RadioGroup<String>(
                  groupValue: form.numberFormat,
                  onChanged: (value) {
                    if (value != null) setState(() => _form = form.copyWith(numberFormat: value));
                  },
                  child: Column(
                    children: [
                      for (final (value, sample, name) in numberChoices)
                        RadioListTile<String>(contentPadding: EdgeInsets.zero, value: value, title: Text(sample), subtitle: Text(name)),
                    ],
                  ),
                ),
              ],
            ),
            Text(
              'Amounts in this app follow the number style. Dates in the app keep their own short form for now.',
              style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
            ),
            StatusText(text: _status, error: _error),
          ],
        );
      }
      return PopScope(
        canPop: !dirty,
        onPopInvokedWithResult: (didPop, _) async {
          if (didPop) return;
          if (await confirmDiscard(context) && context.mounted) {
            setState(() => _form = null);
            Navigator.of(context).pop();
          }
        },
        child: Scaffold(
          appBar: AppBar(title: const Text('Regional')),
          body: body,
          bottomNavigationBar: dirty
              ? SaveBar(busy: _busy, onSave: () => unawaited(_save(form)), onCancel: () => setState(() => _form = null))
              : null,
        ),
      );
    },
  );
}

/* ── Lists and media ──────────────────────────────────────────────────────── */

class ListsSettingsScreen extends StatefulWidget {
  const ListsSettingsScreen({super.key, required this.controller});

  final SettingsController controller;

  @override
  State<ListsSettingsScreen> createState() => _ListsSettingsScreenState();
}

class _ListsSettingsScreenState extends State<ListsSettingsScreen> {
  SettingsController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    unawaited(_c.loadSettings());
    unawaited(_c.loadMedia());
  }

  void _open(Widget screen) => unawaited(Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)));

  static String _count(int shown, int hidden) {
    final values = '$shown value${shown == 1 ? '' : 's'}';
    return hidden == 0 ? values : '$values, $hidden hidden';
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      Widget body;
      if (!_c.settingsLoaded) {
        body = const Center(child: CircularProgressIndicator());
      } else if (_c.notReady) {
        body = ListView(padding: const EdgeInsets.all(Gap.l), children: const [NotReadyNote()]);
      } else {
        final media = _c.media;
        body = ListView(
          padding: const EdgeInsets.symmetric(vertical: Gap.l),
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: Gap.l),
              child: SettingsIntro(
                'The choices dropdowns offer. Values are hidden rather than deleted, because existing orders and vendors keep the ones they have.',
              ),
            ),
            if (_c.settingsError != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Gap.l),
                child: StatusText(text: _c.settingsError, error: true),
              ),
            for (final list in settingsLists)
              Builder(
                builder: (context) {
                  final rows = _c.options(list.key);
                  final hidden = rows.where((r) => r.hidden).length;
                  return ListTile(
                    title: Text(list.title),
                    subtitle: Text('${list.description} ${_count(rows.length - hidden, hidden)}.'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _open(OptionListScreen(controller: _c, list: list)),
                  );
                },
              ),
            const Divider(),
            ListTile(
              title: const Text('Media and sub media'),
              subtitle: Text(
                media == null
                    ? (_c.mediaError ?? 'What vendors supply.')
                    : 'What vendors supply. ${media.length} media type${media.length == 1 ? '' : 's'}, ${_c.subMedia.length} sub media.',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _open(MediaSettingsScreen(controller: _c)),
            ),
          ],
        );
      }
      return Scaffold(
        appBar: AppBar(title: const Text('Lists and media')),
        body: body,
      );
    },
  );
}

/// A small round swatch for a row colour.
class _Swatch extends StatelessWidget {
  const _Swatch(this.hex, {this.size = 16});

  final String hex;
  final double size;

  @override
  Widget build(BuildContext context) {
    final value = colourValue(hex);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: value == null ? Colors.transparent : Color(value),
        border: Border.all(color: Theme.of(context).colorScheme.outline),
      ),
    );
  }
}

/// One list's values: move, hide or show each one, and add new ones.
class OptionListScreen extends StatefulWidget {
  const OptionListScreen({super.key, required this.controller, required this.list});

  final SettingsController controller;
  final SettingsList list;

  @override
  State<OptionListScreen> createState() => _OptionListScreenState();
}

class _OptionListScreenState extends State<OptionListScreen> {
  final _value = TextEditingController();
  String _colour = rowColourChoices.first.$1;
  String? _error;
  bool _busy = false;

  SettingsController get _c => widget.controller;
  SettingsList get _list => widget.list;

  @override
  void dispose() {
    _value.dispose();
    super.dispose();
  }

  Future<bool> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      return true;
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add() async {
    final typed = _value.text.trim();
    if (typed.isEmpty) {
      setState(() => _error = _list.isColor ? 'Name the colour.' : 'Type the new value.');
      return;
    }
    final ok = await _run(() => _list.isColor ? _c.addOption(_list.key, _colour, label: typed) : _c.addOption(_list.key, typed));
    if (ok) _value.clear();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final theme = Theme.of(context);
      final rows = _c.options(_list.key);
      final addLabel = _list.isColor ? 'Name of the new colour' : 'New ${_list.noun}';
      return Scaffold(
        appBar: AppBar(title: Text(_list.title)),
        body: ListView(
          padding: const EdgeInsets.symmetric(vertical: Gap.l),
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Gap.l),
              child: SettingsIntro('${_list.description} Hidden values stay on the records that have them.'),
            ),
            // Always in place, so the fields below keep their state (and focus) while it shows.
            SizedBox(height: 4, child: _busy ? const LinearProgressIndicator() : null),
            if (rows.isEmpty)
              const Padding(
                padding: EdgeInsets.all(Gap.l),
                child: Text('No values yet. Until one is added, dropdowns offer Dikho\'s built-in list.'),
              ),
            for (final (index, row) in rows.indexed)
              ListTile(
                leading: _list.isColor ? _Swatch(row.value) : null,
                title: Text(row.name, style: row.hidden ? TextStyle(color: theme.colorScheme.onSurfaceVariant) : null),
                subtitle: row.hidden ? const Text('Hidden from dropdowns') : null,
                trailing: PopupMenuButton<String>(
                  tooltip: 'Change ${row.name}',
                  enabled: !_busy,
                  onSelected: (action) => unawaited(
                    _run(
                      () => switch (action) {
                        'up' => _c.moveOption(row.id, -1),
                        'down' => _c.moveOption(row.id, 1),
                        _ => _c.setOptionHidden(row.id, !row.hidden),
                      },
                    ),
                  ),
                  itemBuilder: (_) => [
                    PopupMenuItem(value: 'up', enabled: index > 0, child: const Text('Move up')),
                    PopupMenuItem(value: 'down', enabled: index < rows.length - 1, child: const Text('Move down')),
                    PopupMenuItem(value: 'hide', child: Text(row.hidden ? 'Show in dropdowns' : 'Hide from dropdowns')),
                  ],
                ),
              ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_list.isColor) ...[
                    Text('Colour', style: theme.textTheme.titleSmall),
                    const SizedBox(height: Gap.s),
                    Wrap(
                      spacing: Gap.s,
                      runSpacing: Gap.s,
                      children: [
                        for (final (hex, name) in rowColourChoices)
                          Semantics(
                            selected: hex == _colour,
                            button: true,
                            label: name,
                            child: InkResponse(
                              onTap: () => setState(() => _colour = hex),
                              radius: 24,
                              child: Container(
                                width: 48,
                                height: 48,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  border: Border.all(color: hex == _colour ? theme.colorScheme.primary : Colors.transparent, width: 3),
                                ),
                                child: ExcludeSemantics(child: _Swatch(hex, size: 32)),
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: Gap.m),
                  ],
                  TextField(
                    controller: _value,
                    textCapitalization: TextCapitalization.sentences,
                    inputFormatters: [LengthLimitingTextInputFormatter(_list.isColor ? 40 : 60)],
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => unawaited(_add()),
                    onChanged: (_) {
                      if (_error != null) setState(() => _error = null);
                    },
                    decoration: InputDecoration(labelText: addLabel, errorText: _error, errorMaxLines: 3),
                  ),
                  const SizedBox(height: Gap.m),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FilledButton.tonalIcon(
                      onPressed: _busy ? null : () => unawaited(_add()),
                      icon: const Icon(Icons.add),
                      label: const Text('Add'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}

/// "Rename" for a media type or sub media: the name, ready to change.
Future<String?> _askName(BuildContext context, {required String title, required String label, String initial = ''}) => showDialog<String>(
  context: context,
  builder: (_) => _NameDialog(title: title, label: label, initial: initial),
);

class _NameDialog extends StatefulWidget {
  const _NameDialog({required this.title, required this.label, required this.initial});

  final String title;
  final String label;
  final String initial;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  late final _name = TextEditingController(text: widget.initial);
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _done() {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter a name.');
      return;
    }
    Navigator.of(context).pop(name);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: TextField(
      controller: _name,
      autofocus: true,
      textCapitalization: TextCapitalization.words,
      inputFormatters: [LengthLimitingTextInputFormatter(60)],
      onSubmitted: (_) => _done(),
      decoration: InputDecoration(labelText: widget.label, errorText: _error),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
      FilledButton(onPressed: _done, child: const Text('Save')),
    ],
  );
}

/// Media types: what vendors supply. Each opens to its sub media.
class MediaSettingsScreen extends StatefulWidget {
  const MediaSettingsScreen({super.key, required this.controller});

  final SettingsController controller;

  @override
  State<MediaSettingsScreen> createState() => _MediaSettingsScreenState();
}

class _MediaSettingsScreenState extends State<MediaSettingsScreen> {
  final _newMedia = TextEditingController();
  String? _error;
  bool _busy = false;

  SettingsController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    if (_c.media == null) unawaited(_c.loadMedia());
  }

  @override
  void dispose() {
    _newMedia.dispose();
    super.dispose();
  }

  Future<bool> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      return true;
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add() async {
    final name = _newMedia.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Type the new media type.');
      return;
    }
    if (await _run(() => _c.saveMedia(name: name))) _newMedia.clear();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final theme = Theme.of(context);
      final media = _c.media;
      return Scaffold(
        appBar: AppBar(title: const Text('Media and sub media')),
        body: ListView(
          padding: const EdgeInsets.symmetric(vertical: Gap.l),
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: Gap.l),
              child: SettingsIntro('What vendors supply. Renaming updates every vendor at once; hidden ones stay on the vendors that have them.'),
            ),
            // Always in place, so the fields below keep their state (and focus) while it shows.
            SizedBox(height: 4, child: _busy ? const LinearProgressIndicator() : null),
            if (media == null && _c.mediaError == null)
              const Center(
                child: Padding(padding: EdgeInsets.all(Gap.l), child: CircularProgressIndicator()),
              ),
            if (_c.mediaError != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Gap.l),
                child: StatusText(text: _c.mediaError, error: true),
              ),
            for (final item in media ?? const <MediaType>[])
              Builder(
                builder: (context) {
                  final subs = _c.subMedia.where((s) => s.mediaId == item.id).toList();
                  return ListTile(
                    title: Text(item.name, style: item.hidden ? TextStyle(color: theme.colorScheme.onSurfaceVariant) : null),
                    subtitle: Text(['${subs.length} sub media', if (item.hidden) 'Hidden from pickers'].join(' · ')),
                    onTap: () => unawaited(
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => SubMediaSettingsScreen(controller: _c, mediaId: item.id),
                        ),
                      ),
                    ),
                    trailing: PopupMenuButton<String>(
                      tooltip: 'Change ${item.name}',
                      enabled: !_busy,
                      onSelected: (action) async {
                        if (action == 'rename') {
                          final name = await _askName(context, title: 'Rename media type', label: 'Media name', initial: item.name);
                          if (name != null && name != item.name) await _run(() => _c.saveMedia(id: item.id, name: name));
                        } else {
                          await _run(() => _c.saveMedia(id: item.id, hidden: !item.hidden));
                        }
                      },
                      itemBuilder: (_) => [
                        const PopupMenuItem(value: 'rename', child: Text('Rename')),
                        PopupMenuItem(value: 'hide', child: Text(item.hidden ? 'Show in pickers' : 'Hide from pickers')),
                      ],
                    ),
                  );
                },
              ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _newMedia,
                    textCapitalization: TextCapitalization.words,
                    inputFormatters: [LengthLimitingTextInputFormatter(60)],
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => unawaited(_add()),
                    onChanged: (_) {
                      if (_error != null) setState(() => _error = null);
                    },
                    decoration: InputDecoration(labelText: 'New media type', errorText: _error, errorMaxLines: 3),
                  ),
                  const SizedBox(height: Gap.m),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FilledButton.tonalIcon(
                      onPressed: _busy ? null : () => unawaited(_add()),
                      icon: const Icon(Icons.add),
                      label: const Text('Add'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}

/// One media type's sub media.
class SubMediaSettingsScreen extends StatefulWidget {
  const SubMediaSettingsScreen({super.key, required this.controller, required this.mediaId});

  final SettingsController controller;
  final int mediaId;

  @override
  State<SubMediaSettingsScreen> createState() => _SubMediaSettingsScreenState();
}

class _SubMediaSettingsScreenState extends State<SubMediaSettingsScreen> {
  final _newSub = TextEditingController();
  String? _error;
  bool _busy = false;

  SettingsController get _c => widget.controller;

  @override
  void dispose() {
    _newSub.dispose();
    super.dispose();
  }

  Future<bool> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      return true;
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final theme = Theme.of(context);
      final media = (_c.media ?? const <MediaType>[]).where((m) => m.id == widget.mediaId).firstOrNull;
      final mediaName = media?.name ?? 'Media';
      final subs = _c.subMedia.where((s) => s.mediaId == widget.mediaId).toList();
      Future<void> add() async {
        final name = _newSub.text.trim();
        if (name.isEmpty) {
          setState(() => _error = 'Type a sub media for $mediaName.');
          return;
        }
        if (await _run(() => _c.saveSubMedia(mediaId: widget.mediaId, name: name))) _newSub.clear();
      }

      return Scaffold(
        appBar: AppBar(title: Text(mediaName)),
        body: ListView(
          padding: const EdgeInsets.symmetric(vertical: Gap.l),
          children: [
            // Always in place, so the fields below keep their state (and focus) while it shows.
            SizedBox(height: 4, child: _busy ? const LinearProgressIndicator() : null),
            if (subs.isEmpty) Padding(padding: const EdgeInsets.all(Gap.l), child: Text('No sub media for $mediaName yet.')),
            for (final sub in subs)
              ListTile(
                title: Text(sub.name, style: sub.hidden ? TextStyle(color: theme.colorScheme.onSurfaceVariant) : null),
                subtitle: sub.hidden ? const Text('Hidden from pickers') : null,
                trailing: PopupMenuButton<String>(
                  tooltip: 'Change ${sub.name}',
                  enabled: !_busy,
                  onSelected: (action) async {
                    if (action == 'rename') {
                      final name = await _askName(context, title: 'Rename sub media', label: 'Sub media name', initial: sub.name);
                      if (name != null && name != sub.name) await _run(() => _c.saveSubMedia(id: sub.id, name: name));
                    } else {
                      await _run(() => _c.saveSubMedia(id: sub.id, hidden: !sub.hidden));
                    }
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'rename', child: Text('Rename')),
                    PopupMenuItem(value: 'hide', child: Text(sub.hidden ? 'Show in pickers' : 'Hide from pickers')),
                  ],
                ),
              ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _newSub,
                    textCapitalization: TextCapitalization.words,
                    inputFormatters: [LengthLimitingTextInputFormatter(60)],
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => unawaited(add()),
                    onChanged: (_) {
                      if (_error != null) setState(() => _error = null);
                    },
                    decoration: InputDecoration(labelText: 'New sub media for $mediaName', errorText: _error, errorMaxLines: 3),
                  ),
                  const SizedBox(height: Gap.m),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FilledButton.tonalIcon(
                      onPressed: _busy ? null : () => unawaited(add()),
                      icon: const Icon(Icons.add),
                      label: const Text('Add'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}
