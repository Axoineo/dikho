import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'chat_theme.dart';
import 'inbox_format.dart';
import 'inbox_models.dart';
import 'inbox_scope.dart';
import 'inbox_widgets.dart';

/// One message. Bubbles are as wide as their content, up to most of the screen,
/// and the clock sits on the last line of text with room reserved for it.
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.message,
    required this.startsRun,
    this.reactions,
    this.quoted,
    this.quotedAuthor = '',
    this.searchTerm = '',
    this.highlighted = false,
    this.onLongPress,
    this.onOpenMedia,
    this.onJumpToQuote,
  });

  final Message message;
  final bool startsRun;
  final Reactions? reactions;
  final Message? quoted;
  final String quotedAuthor;
  final String searchTerm;
  final bool highlighted;
  final VoidCallback? onLongPress;
  final ValueChanged<Message>? onOpenMedia;
  final VoidCallback? onJumpToQuote;

  static final _callBody = RegExp(r'^missed (voice|video) call$', caseSensitive: false);

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    final outbound = message.isOutbound;
    final screen = MediaQuery.sizeOf(context).width;
    final rich = message.isRich;
    final hasMedia = !rich && message.type != 'text' && (message.mediaUrl != null || message.mediaStatus != null);
    final isCall = message.type == 'call' || _callBody.hasMatch(message.body ?? '');
    final placeholder = rich ? null : placeholderLabel(message.body);
    final bodyText = rich || placeholder != null || isCall ? null : message.body;
    final visual = hasMedia && (message.isImage || message.isVideo);
    final overImage = hasMedia && message.isImage && bodyText == null && placeholder == null;
    final hasReactions = reactions != null && !reactions!.isEmpty;
    final maxWidth = visual ? math.min(screen * 0.82, 288.0) : screen * 0.82;
    final textColor = outbound ? chat.bubbleOutText : chat.text;
    final secondary = outbound ? chat.meta : chat.sub;

    final meta = MessageClock(message: message, color: overImage ? Colors.white : secondary, overImage: overImage);

    final blocks = <Widget>[
      if (message.payload?['forwarded'] != null)
        Padding(
          padding: const EdgeInsets.fromLTRB(9, 5, 9, 0),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.shortcut, size: 13, color: secondary),
              const SizedBox(width: Gap.xs),
              Text(
                message.payload!['forwarded'] == 'many' ? 'Forwarded many times' : 'Forwarded',
                style: TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic, color: secondary),
              ),
            ],
          ),
        ),
      if (message.payload?['referral'] is Map) _ReferralBanner(referral: message.payload!['referral'] as Map, secondary: secondary),
      if (quoted != null) _Quote(quoted: quoted!, author: quotedAuthor, mine: quoted!.isOutbound, secondary: secondary, onTap: onJumpToQuote),
      if (isCall)
        _CallRow(label: message.body ?? 'Missed voice call', time: formatTime(message.at), secondary: secondary)
      else if (rich)
        RichBody(message: message, textColor: textColor, secondary: secondary, meta: meta, searchTerm: searchTerm)
      else if (hasMedia) ...[
        Padding(
          padding: const EdgeInsets.all(3),
          child: _MediaBody(message: message, secondary: secondary, onOpen: onOpenMedia),
        ),
        if (bodyText == null && placeholder == null && !overImage)
          Align(
            alignment: Alignment.centerRight,
            child: Padding(padding: const EdgeInsets.fromLTRB(9, 0, 7, 3), child: meta),
          ),
      ],
      if (placeholder != null)
        _TextWithClock(
          spans: [
            TextSpan(
              text: placeholder,
              style: TextStyle(fontStyle: FontStyle.italic, color: secondary),
            ),
          ],
          color: textColor,
          meta: meta,
        ),
      if (bodyText != null) _TextWithClock(spans: highlightSpans(bodyText, searchTerm, chat.hit), color: textColor, meta: meta),
    ];

    final bubbleColor = outbound ? chat.bubbleOut : chat.bubbleIn;
    final radius = BorderRadius.only(
      topLeft: Radius.circular(!outbound && startsRun ? 0 : 8),
      topRight: Radius.circular(outbound && startsRun ? 0 : 8),
      bottomLeft: const Radius.circular(8),
      bottomRight: const Radius.circular(8),
    );

    return Padding(
      padding: EdgeInsets.only(top: startsRun ? Gap.m : 2, bottom: hasReactions ? 18 : 0, left: Gap.m, right: Gap.m),
      child: Align(
        alignment: outbound ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth),
          child: GestureDetector(
            onLongPress: onLongPress,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                if (startsRun)
                  Positioned(
                    top: 0,
                    left: outbound ? null : -8,
                    right: outbound ? -8 : null,
                    child: CustomPaint(
                      size: const Size(8, 13),
                      painter: _Tail(bubbleColor, outbound: outbound),
                    ),
                  ),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  decoration: BoxDecoration(
                    color: bubbleColor,
                    borderRadius: radius,
                    border: highlighted ? Border.all(color: chat.tick, width: 2) : null,
                    boxShadow: const [BoxShadow(color: Color(0x210B141A), blurRadius: 0.5, offset: Offset(0, 1))],
                  ),
                  child: ClipRRect(
                    borderRadius: radius,
                    child: Stack(
                      children: [
                        Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: blocks),
                        if (overImage)
                          Positioned(
                            right: 0,
                            bottom: 0,
                            child: Container(
                              padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, 9, 6),
                              decoration: const BoxDecoration(
                                gradient: RadialGradient(center: Alignment.bottomRight, radius: 1.4, colors: [Color(0x99000000), Color(0x00000000)]),
                              ),
                              child: meta,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                if (hasReactions)
                  Positioned(
                    bottom: -17,
                    left: outbound ? null : Gap.s,
                    right: outbound ? Gap.s : null,
                    child: _ReactionBadge(reactions: reactions!),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Marks each run of the search term. The term is matched as plain text, so a
/// customer message containing "(" cannot break it.
List<InlineSpan> highlightSpans(String text, String term, Color hit) {
  if (term.isEmpty) return [TextSpan(text: text)];
  final spans = <InlineSpan>[];
  final lower = text.toLowerCase();
  final needle = term.toLowerCase();
  var from = 0;
  while (true) {
    final index = lower.indexOf(needle, from);
    if (index < 0) break;
    if (index > from) spans.add(TextSpan(text: text.substring(from, index)));
    spans.add(
      TextSpan(
        text: text.substring(index, index + needle.length),
        style: TextStyle(backgroundColor: hit),
      ),
    );
    from = index + needle.length;
  }
  spans.add(TextSpan(text: text.substring(from)));
  return spans;
}

class _Tail extends CustomPainter {
  _Tail(this.color, {required this.outbound});

  final Color color;
  final bool outbound;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path();
    if (outbound) {
      path
        ..moveTo(0, 0)
        ..lineTo(size.width, 0)
        ..lineTo(0, size.height);
    } else {
      path
        ..moveTo(size.width, 0)
        ..lineTo(0, 0)
        ..lineTo(size.width, size.height);
    }
    canvas.drawPath(path..close(), Paint()..color = color);
  }

  @override
  bool shouldRepaint(_Tail oldDelegate) => oldDelegate.color != color;
}

class MessageClock extends StatelessWidget {
  const MessageClock({super.key, required this.message, required this.color, this.overImage = false});

  final Message message;
  final Color color;
  final bool overImage;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (message.starred) ...[Icon(Icons.star, size: 11, color: color, semanticLabel: 'Starred'), const SizedBox(width: 3)],
        if (message.pinnedAt != null) ...[Icon(Icons.push_pin, size: 11, color: color, semanticLabel: 'Pinned'), const SizedBox(width: 3)],
        Text(formatTime(message.at), style: TextStyle(fontSize: 11, color: color)),
        if (message.isOutbound) ...[
          const SizedBox(width: 3),
          DeliveryTicks(status: message.status, color: color, readColor: overImage ? const Color(0xFF7CD0F5) : null),
        ],
      ],
    );
  }
}

/// Text with the clock in the corner. An invisible stand-in the clock's width sits
/// at the end of the text, so a short message keeps it on the same line and a full
/// line pushes it down.
class _TextWithClock extends StatelessWidget {
  const _TextWithClock({required this.spans, required this.color, required this.meta});

  final List<InlineSpan> spans;
  final Color color;
  final MessageClock meta;

  @override
  Widget build(BuildContext context) {
    final message = meta.message;
    final scale = MediaQuery.textScalerOf(context).scale(11) / 11;
    final reserved = (52 + (message.isOutbound ? 18 : 0) + (message.starred ? 14 : 0) + (message.pinnedAt != null ? 14 : 0)) * scale;
    return Stack(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(9, 5, 7, 5),
          child: Text.rich(
            TextSpan(
              style: TextStyle(fontSize: 14.5, height: 1.32, color: color),
              children: [
                ...spans,
                WidgetSpan(child: SizedBox(width: reserved, height: 1)),
              ],
            ),
          ),
        ),
        Positioned(right: 7, bottom: 4, child: meta),
      ],
    );
  }
}

class _Quote extends StatelessWidget {
  const _Quote({required this.quoted, required this.author, required this.mine, required this.secondary, this.onTap});

  final Message quoted;
  final String author;
  final bool mine;
  final Color secondary;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    final accent = mine ? chat.quoteYou : chat.quoteThem;
    return Padding(
      padding: const EdgeInsets.fromLTRB(3, 3, 3, 0),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Ink(
          decoration: BoxDecoration(color: chat.quote, borderRadius: BorderRadius.circular(6)),
          child: IntrinsicHeight(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  width: 4,
                  decoration: BoxDecoration(
                    color: accent,
                    borderRadius: const BorderRadius.horizontal(left: Radius.circular(6)),
                  ),
                ),
                Flexible(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: Gap.s, vertical: 5),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          author,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 12.8, fontWeight: FontWeight.w600, color: accent),
                        ),
                        Text(
                          quoted.snippet,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13, color: secondary),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ReactionBadge extends StatelessWidget {
  const _ReactionBadge({required this.reactions});

  final Reactions reactions;

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    final customer = reactions.customer;
    final business = reactions.business;
    final same = customer != null && customer == business;
    final emojis = same ? [customer] : [?customer, ?business];
    final label = [if (customer != null) 'Customer reacted $customer', if (business != null) 'You reacted $business'].join(', ');
    return Semantics(
      label: label,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        decoration: BoxDecoration(
          color: chat.raised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: chat.canvas),
          boxShadow: const [BoxShadow(color: Color(0x210B141A), blurRadius: 1, offset: Offset(0, 1))],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final emoji in emojis) Text(emoji, style: const TextStyle(fontSize: 14)),
            if (same)
              Padding(
                padding: const EdgeInsets.only(left: 2),
                child: Text('2', style: TextStyle(fontSize: 11.5, color: chat.sub)),
              ),
          ],
        ),
      ),
    );
  }
}

class _CallRow extends StatelessWidget {
  const _CallRow({required this.label, required this.time, required this.secondary});

  final String label;
  final String time;
  final Color secondary;

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    return Padding(
      padding: const EdgeInsets.all(Gap.s),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: 17,
            backgroundColor: chat.ring,
            child: Icon(Icons.call_missed, size: 16, color: Theme.of(context).colorScheme.error),
          ),
          const SizedBox(width: Gap.m),
          Flexible(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(fontSize: 14)),
                Text(time, style: TextStyle(fontSize: 11.5, color: secondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReferralBanner extends StatelessWidget {
  const _ReferralBanner({required this.referral, required this.secondary});

  final Map referral;
  final Color secondary;

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    final headline = referral['headline'];
    final body = referral['body'];
    final url = referral['source_url'];
    return Padding(
      padding: const EdgeInsets.fromLTRB(3, 3, 3, 0),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(color: chat.quote, borderRadius: BorderRadius.circular(6)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'FROM AN AD',
              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: chat.quoteThem),
            ),
            if (headline is String) Text(headline, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500)),
            if (body is String)
              Text(
                body,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12.5, color: secondary),
              ),
            if (url is String) _ExternalLink(url: url, label: 'View ad', color: chat.actionIn),
          ],
        ),
      ),
    );
  }
}

/// A link from a message: only http or https, and only opened by asking the person's
/// browser, never inside the app.
class _ExternalLink extends StatelessWidget {
  const _ExternalLink({required this.url, required this.label, required this.color});

  final String url;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final uri = Uri.tryParse(url);
    final safe = uri != null && (uri.scheme == 'https' || uri.scheme == 'http');
    return GestureDetector(
      onTap: safe ? () => fireAndForget(InboxScope.of(context).platform.openExternal(url).then((_) {})) : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.xs),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 12.5, color: color),
        ),
      ),
    );
  }
}

class _MediaBody extends StatelessWidget {
  const _MediaBody({required this.message, required this.secondary, this.onOpen});

  final Message message;
  final Color secondary;
  final ValueChanged<Message>? onOpen;

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    final status = message.mediaStatus;
    final url = message.mediaUrl;
    Widget box(Widget child, {double? height}) => Container(
      constraints: const BoxConstraints(minWidth: 208),
      height: height,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: chat.ring, borderRadius: BorderRadius.circular(6)),
      child: child,
    );

    if (status == 'pending') {
      return box(Text('Downloading…', style: TextStyle(fontSize: 12, color: secondary)), height: 120);
    }
    if (status == 'failed' || url == null) {
      return box(Text('Media unavailable', style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.error)));
    }
    if (message.isAudio) return VoicePlayerRow(message: message, secondary: secondary);
    if (message.isImage) {
      return GestureDetector(
        onTap: () => onOpen?.call(message),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 96, maxHeight: 288, minWidth: 96),
            child: Semantics(
              image: true,
              label: message.mediaFilename ?? 'Photo',
              button: true,
              child: CachedMediaImage(
                path: url,
                decodeWidth: 288,
                placeholder: Container(width: 208, height: 160, color: chat.ring),
                failure: box(Text('Media unavailable', style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.error))),
              ),
            ),
          ),
        ),
      );
    }
    final video = message.isVideo;
    return InkWell(
      onTap: () => onOpen?.call(message),
      borderRadius: BorderRadius.circular(6),
      child: Ink(
        decoration: BoxDecoration(color: chat.quote, borderRadius: BorderRadius.circular(6)),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: Gap.m, vertical: Gap.s + 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                video ? Icons.play_circle_outline : Icons.description_outlined,
                color: message.isOutbound ? chat.actionOut : chat.actionIn,
                size: 28,
              ),
              const SizedBox(width: Gap.m),
              Flexible(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      message.mediaFilename ?? (video ? 'Video' : 'Document'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500),
                    ),
                    Text(_fileLine(message), style: TextStyle(fontSize: 11.5, color: secondary)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _fileLine(Message m) {
    final name = m.mediaFilename ?? '';
    final ext = name.contains('.') ? name.split('.').last.toUpperCase() : '';
    final label = ext.isNotEmpty
        ? ext.substring(0, math.min(ext.length, 4))
        : m.mediaMime == 'application/pdf'
        ? 'PDF'
        : (m.mediaMime.split('/').lastOrNull ?? 'FILE').toUpperCase();
    final size = formatFileSize(m.mediaSize);
    return size.isEmpty ? label : '$label · $size';
  }
}

/// Plays in place: fetched on first tap, then from the cache.
class VoicePlayerRow extends StatefulWidget {
  const VoicePlayerRow({super.key, required this.message, required this.secondary});

  final Message message;
  final Color secondary;

  @override
  State<VoicePlayerRow> createState() => _VoicePlayerRowState();
}

class _VoicePlayerRowState extends State<VoicePlayerRow> {
  bool _fetching = false;

  String get _id => 'm${widget.message.id}';

  Future<void> _toggle(InboxScope scope) async {
    final audio = scope.audio;
    if (audio.isPlaying(_id)) {
      unawaited(scope.platform.audioPause());
      return;
    }
    final url = widget.message.mediaUrl;
    if (url == null || _fetching) return;
    setState(() => _fetching = true);
    try {
      final file = await scope.media.fileFor(url);
      await scope.platform.audioPlay(_id, file.path);
    } on Exception {
      if (mounted) showNotice(context, 'That audio could not be played. Please try again.');
    } finally {
      if (mounted) setState(() => _fetching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scope = InboxScope.of(context);
    final chat = ChatColors.of(context);
    final action = widget.message.isOutbound ? chat.actionOut : chat.actionIn;
    return ListenableBuilder(
      listenable: scope.audio,
      builder: (context, _) {
        final audio = scope.audio;
        final mine = audio.id == _id;
        final playing = audio.isPlaying(_id);
        final total = mine ? audio.durationMs : 0;
        final position = mine ? audio.positionMs : 0;
        return SizedBox(
          width: 232,
          child: Row(
            children: [
              if (widget.message.isVoice)
                Padding(
                  padding: const EdgeInsets.only(left: Gap.xs),
                  child: Icon(Icons.mic, size: 18, color: action, semanticLabel: 'Voice message'),
                ),
              IconButton(
                tooltip: playing ? 'Pause' : 'Play',
                onPressed: () => _toggle(scope),
                icon: _fetching
                    ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: action))
                    : Icon(playing ? Icons.pause : Icons.play_arrow, color: action),
              ),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        trackHeight: 3,
                        overlayShape: SliderComponentShape.noOverlay,
                        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                        activeTrackColor: action,
                        thumbColor: action,
                        inactiveTrackColor: chat.ring,
                      ),
                      child: Slider(
                        value: total > 0 ? position.clamp(0, total).toDouble() : 0,
                        max: total > 0 ? total.toDouble() : 1,
                        onChanged: mine && total > 0 ? (value) => unawaited(scope.platform.audioSeek(value.round())) : null,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Padding(
                      padding: const EdgeInsets.only(left: Gap.xs),
                      child: Text(
                        total > 0 ? formatDuration(playing ? position : total) : formatFileSize(widget.message.mediaSize),
                        style: TextStyle(fontSize: 11, color: widget.secondary),
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
}

/// Messages that are more than text or a file. The payload comes from the API;
/// the plain body is only a summary and is not shown when one of these renders.
class RichBody extends StatelessWidget {
  const RichBody({super.key, required this.message, required this.textColor, required this.secondary, required this.meta, this.searchTerm = ''});

  final Message message;
  final Color textColor;
  final Color secondary;
  final MessageClock meta;
  final String searchTerm;

  static const _addressLabels = [
    ('name', 'Name'),
    ('phone_number', 'Phone'),
    ('house_number', 'House'),
    ('floor_number', 'Floor'),
    ('tower_number', 'Tower'),
    ('building_name', 'Building'),
    ('address', 'Address'),
    ('landmark_area', 'Landmark'),
    ('city', 'City'),
    ('state', 'State'),
    ('in_pin_code', 'PIN code'),
  ];

  String? _text(Map<String, dynamic> map, String key) {
    final value = map[key];
    return value is String && value.isNotEmpty ? value : null;
  }

  List<String> _strings(Object? value) => [
    for (final item in value is List ? value : const [])
      if (item is String) item,
  ];

  @override
  Widget build(BuildContext context) {
    final payload = message.payload ?? const <String, dynamic>{};
    final chat = ChatColors.of(context);
    final action = message.isOutbound ? chat.actionOut : chat.actionIn;
    final kind = payload['kind'];
    final clockBelow = Align(
      alignment: Alignment.centerRight,
      child: Padding(padding: const EdgeInsets.fromLTRB(9, Gap.xs, 7, 3), child: meta),
    );

    switch (kind) {
      case 'location':
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [_location(context, payload, chat, action), clockBelow],
        );
      case 'contacts':
        final people = payload['contacts'] is List ? payload['contacts'] as List : const [];
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final person in people)
              if (person is Map<String, dynamic>) _contactCard(person, chat),
            clockBelow,
          ],
        );
      case 'interactive':
        final type = payload['interactive_type'];
        final rows = <(String, IconData?)>[
          if (type == 'buttons') ...[for (final b in _strings(payload['buttons'])) (b, Icons.reply)],
          if (type == 'list' && _text(payload, 'button') != null) (_text(payload, 'button')!, Icons.list),
          if (type == 'cta_url' && _text(payload, 'label') != null) (_text(payload, 'label')!, Icons.open_in_new),
          if (type == 'location_request') ('Send location', Icons.place_outlined),
          if (type == 'address') ('Send address', Icons.home_outlined),
        ];
        final sections = payload['sections'] is List ? payload['sections'] as List : const [];
        final options = <String>[
          for (final section in sections)
            if (section is Map && section['rows'] is List)
              for (final row in section['rows'] as List)
                if (row is Map && row['title'] is String)
                  '• ${row['title']}${row['description'] is String && (row['description'] as String).isNotEmpty ? ' · ${row['description']}' : ''}',
        ];
        final url = _text(payload, 'url');
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _composed(payload, chat),
            if (options.isNotEmpty)
              Container(
                decoration: BoxDecoration(
                  border: Border(top: BorderSide(color: chat.ring)),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final option in options)
                      Text(
                        option,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12.5, color: secondary),
                      ),
                  ],
                ),
              ),
            if (type == 'cta_url' && url != null)
              Container(
                decoration: BoxDecoration(
                  border: Border(top: BorderSide(color: chat.ring)),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 9),
                child: _ExternalLink(url: url, label: url, color: secondary),
              ),
            for (final (label, icon) in rows) _actionRow(label, icon, chat, action),
          ],
        );
      case 'template':
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(9, 5, 7, 0),
              child: Text(
                'TEMPLATE · ${_text(payload, 'name') ?? ''}',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, letterSpacing: .3, color: secondary),
              ),
            ),
            _composed(payload, chat),
            for (final label in _strings(payload['buttons'])) _actionRow(label, null, chat, action),
          ],
        );
      case 'form_reply':
        final values = payload['values'] is Map ? (payload['values'] as Map).cast<String, Object?>() : const <String, Object?>{};
        final address = payload['name'] == 'address_message';
        final rows = address
            ? [
                for (final (key, label) in _addressLabels)
                  if (values[key] != null && values[key] != '') (label, '${values[key]}'),
              ]
            : [for (final entry in values.entries) (entry.key, '${entry.value}')];
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(9, 5, 7, 0),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (address) _heading(Icons.home_outlined, 'Delivery address', action),
                  if (rows.isEmpty) Text('Form submitted', style: TextStyle(fontSize: 13.5, color: secondary)),
                  for (final (label, value) in rows)
                    Text.rich(
                      TextSpan(
                        style: TextStyle(fontSize: 13.5, color: textColor),
                        children: [
                          TextSpan(
                            text: '$label: ',
                            style: TextStyle(color: secondary),
                          ),
                          TextSpan(text: value),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            clockBelow,
          ],
        );
      case 'order':
        final items = payload['items'] is List ? payload['items'] as List : const [];
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(9, 5, 7, 0),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _heading(Icons.shopping_cart_outlined, 'Order · ${items.length} items', action),
                  for (final item in items)
                    if (item is Map)
                      Text(
                        '${item['quantity']} × ${item['product']}${item['price'] != null ? ' · ${item['currency'] ?? ''} ${item['price']}' : ''}',
                        style: TextStyle(fontSize: 13.5, color: textColor),
                      ),
                  if (_text(payload, 'text') != null)
                    Padding(
                      padding: const EdgeInsets.only(top: Gap.xs),
                      child: Text(_text(payload, 'text')!, style: TextStyle(fontSize: 13.5, color: textColor)),
                    ),
                ],
              ),
            ),
            clockBelow,
          ],
        );
      default:
        return clockBelow;
    }
  }

  Widget _heading(IconData icon, String text, Color color) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.xs),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: color),
        const SizedBox(width: Gap.xs + 2),
        Flexible(
          child: Text(
            text,
            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: color),
          ),
        ),
      ],
    ),
  );

  Widget _composed(Map<String, dynamic> payload, ChatColors chat) {
    final header = _text(payload, 'header');
    final body = _text(payload, 'body');
    final footer = _text(payload, 'footer');
    return Padding(
      padding: const EdgeInsets.fromLTRB(9, 5, 7, 0),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (header != null)
            Text(
              header,
              style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: textColor),
            ),
          if (body != null)
            Text.rich(
              TextSpan(
                style: TextStyle(fontSize: 14.5, height: 1.32, color: textColor),
                children: highlightSpans(body, searchTerm, chat.hit),
              ),
            ),
          if (footer != null) Text(footer, style: TextStyle(fontSize: 12.5, color: secondary)),
          Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.only(top: 2, bottom: Gap.xs),
              child: meta,
            ),
          ),
        ],
      ),
    );
  }

  Widget _actionRow(String label, IconData? icon, ChatColors chat, Color action) => Container(
    decoration: BoxDecoration(
      border: Border(top: BorderSide(color: chat.ring)),
    ),
    padding: const EdgeInsets.symmetric(horizontal: Gap.m, vertical: 9),
    alignment: Alignment.center,
    constraints: const BoxConstraints(minWidth: 180),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[Icon(icon, size: 15, color: action), const SizedBox(width: Gap.xs + 2)],
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: action),
          ),
        ),
      ],
    ),
  );

  Widget _location(BuildContext context, Map<String, dynamic> payload, ChatColors chat, Color action) {
    final lat = (payload['latitude'] as num?)?.toDouble();
    final lng = (payload['longitude'] as num?)?.toDouble();
    final hasPoint = lat != null && lng != null;
    return Padding(
      padding: const EdgeInsets.fromLTRB(3, 3, 3, 0),
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: hasPoint
            ? () => fireAndForget(
                InboxScope.of(context).platform.openExternal('https://www.google.com/maps/search/?api=1&query=$lat,$lng').then((_) {}),
              )
            : null,
        child: Ink(
          decoration: BoxDecoration(color: chat.quote, borderRadius: BorderRadius.circular(6)),
          child: Padding(
            padding: const EdgeInsets.all(Gap.m),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: chat.raised,
                  child: Icon(Icons.place_outlined, size: 18, color: action),
                ),
                const SizedBox(width: Gap.s + 2),
                Flexible(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _text(payload, 'name') ?? 'Location',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
                      ),
                      if (_text(payload, 'address') != null)
                        Text(
                          _text(payload, 'address')!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 12.5, color: secondary),
                        ),
                      if (hasPoint) Text('${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}', style: TextStyle(fontSize: 12, color: secondary)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _contactCard(Map<String, dynamic> person, ChatColors chat) => Padding(
    padding: const EdgeInsets.fromLTRB(3, 3, 3, 0),
    child: Container(
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: chat.quote, borderRadius: BorderRadius.circular(6)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: chat.raised,
            child: Icon(Icons.person_outline, size: 18, color: secondary),
          ),
          const SizedBox(width: Gap.s + 2),
          Flexible(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _text(person, 'name') ?? 'Contact',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
                ),
                if (_text(person, 'org') != null)
                  Text(
                    _text(person, 'org')!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12.5, color: secondary),
                  ),
                for (final phone in person['phones'] is List ? person['phones'] as List : const [])
                  if (phone is Map && phone['phone'] != null) SelectableText('${phone['phone']}', style: TextStyle(fontSize: 12.5, color: secondary)),
                for (final email in _strings(person['emails'])) SelectableText(email, style: TextStyle(fontSize: 12.5, color: secondary)),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}
