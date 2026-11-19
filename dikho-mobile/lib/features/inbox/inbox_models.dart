import 'dart:convert';

import 'inbox_format.dart';

/// One row of the chat list. Keeps the API's map, because a realtime event carries
/// only some fields and they are merged in as they come.
class Conversation {
  Conversation(this.raw);

  final Map<String, dynamic> raw;

  int get id => raw['id'] as int;
  String get phone => raw['phone'] as String? ?? '';
  String? get waName => _text('wa_name');
  String? get contactName => _text('contact_name');
  String? get avatarUrl => _text('avatar_url');
  int get unreadCount => raw['unread_count'] as int? ?? 0;
  String? get lastMessageAt => _text('last_message_at');
  String? get lastInboundAt => _text('last_inbound_at');
  String? get lastMessagePreview => _text('last_message_preview');
  String? get lastMessageDirection => _text('last_message_direction');
  String? get lastMessageStatus => _text('last_message_status');
  String? get blockedAt => _text('blocked_at');
  int? get clearedThroughId => raw['cleared_through_id'] as int?;
  bool get isBlocked => blockedAt != null;
  String get displayName => waName ?? contactName ?? '+$phone';
  String? get avatarName => waName ?? contactName;

  Duration windowLeft({DateTime? now}) => sessionLeft(lastInboundAt, now: now);

  /// Meta only lets a business block someone who messaged in the last 24 hours.
  bool get canBlockNow => windowLeft() > Duration.zero;

  String? _text(String key) {
    final value = raw[key];
    return value is String && value.isNotEmpty ? value : null;
  }

  Conversation merged(Map<String, dynamic> patch) => Conversation({...raw, ...patch});
}

/// Message kinds the bubble lays out itself rather than as text or a file.
const _richKinds = {'location', 'contacts', 'interactive', 'template', 'form_reply', 'order'};
const _forwardable = {'text', 'image', 'video', 'audio', 'document', 'sticker', 'location'};
final _thirtyDays = const Duration(days: 30);

class Message {
  Message(this.raw);

  final Map<String, dynamic> raw;

  int get id => raw['id'] as int;
  String? get metaMessageId => _text('meta_message_id');
  bool get isOutbound => raw['direction'] == 'outbound';
  String get direction => raw['direction'] as String? ?? '';
  String get type => raw['type'] as String? ?? 'text';
  String? get body => _text('body');
  String get status => raw['status'] as String? ?? '';
  String? get contextWamid => _text('context_wamid');
  String? get waTimestamp => _text('wa_timestamp');
  String get createdAt => raw['created_at'] as String? ?? '';
  String? get at => waTimestamp ?? _text('created_at');
  String? get mediaUrl => _text('media_url');
  String get mediaMime => raw['media_mime'] as String? ?? '';
  String? get mediaStatus => _text('media_status');
  String? get mediaFilename => _text('media_filename');
  int? get mediaSize => raw['media_size'] as int?;
  String? get pinnedAt => _text('pinned_at');
  bool get starred => raw['starred'] == 1 || raw['starred'] == true;

  bool get isImage => mediaMime.startsWith('image/');
  bool get isVideo => mediaMime.startsWith('video/');
  bool get isAudio => mediaMime.startsWith('audio/');

  late final Map<String, dynamic>? payload = _parsePayload();

  bool get isRich => _richKinds.contains(payload?['kind']);
  bool get isVoice => payload?['kind'] == 'voice';

  Map<String, dynamic>? _parsePayload() {
    final value = raw['payload'];
    if (value is Map<String, dynamic>) return value;
    if (value is! String || value.isEmpty) return null;
    try {
      final decoded = jsonDecode(value);
      return decoded is Map<String, dynamic> ? decoded : null;
    } on FormatException {
      return null;
    }
  }

  String? _text(String key) {
    final value = raw[key];
    return value is String && value.isNotEmpty ? value : null;
  }

  Message merged(Map<String, dynamic> patch) => Message({...raw, ...patch});

  /// Meta refuses reactions to messages over 30 days old.
  bool canReact({DateTime? now}) {
    if (metaMessageId == null || type == 'reaction' || type == 'system') return false;
    final d = parseWaDate(at);
    return d != null && (now ?? DateTime.now()).difference(d) < _thirtyDays;
  }

  bool get canForward {
    if (!_forwardable.contains(type)) return false;
    if (type == 'text') return (body ?? '').trim().isNotEmpty;
    if (type == 'location') return true;
    return mediaStatus == 'ready' && mediaUrl != null;
  }

  /// In the full-screen viewer, rather than played in place.
  bool get isViewable => type != 'text' && mediaStatus == 'ready' && mediaUrl != null && !isAudio;

  /// One line describing a message, for quotes, the pinned bar and the reply bar.
  String get snippet {
    if (isVoice) return 'Voice message';
    final text = body;
    if (text != null) return text;
    if (isImage) return type == 'sticker' ? 'Sticker' : 'Photo';
    if (isVideo) return 'Video';
    if (isAudio) return 'Audio';
    return mediaFilename ?? 'Message';
  }
}

/// The open thread: its rows plus where the next older page starts. [before] is
/// kept apart from the first row because a realtime append can be older than every
/// fetched row (a late webhook carries WhatsApp's own timestamp), and once sorted
/// in it would sit in front of rows the server still has to send.
class ThreadData {
  const ThreadData({this.messages = const [], this.hasMore = false, this.before});

  final List<Message> messages;
  final bool hasMore;
  final int? before;

  ThreadData withMessages(List<Message> next) => ThreadData(messages: next, hasMore: hasMore, before: before);
}

class ThreadPage {
  const ThreadPage({required this.messages, required this.hasMore});

  factory ThreadPage.fromJson(Map<String, dynamic> json) => ThreadPage(
    messages: [
      for (final row in (json['messages'] as List? ?? const []))
        if (row is Map<String, dynamic>) Message(row),
    ],
    hasMore: json['hasMore'] == true,
  );

  final List<Message> messages;
  final bool hasMore;
}

int _byTime(Message a, Message b) {
  final at = a.createdAt.compareTo(b.createdAt);
  return at != 0 ? at : a.id.compareTo(b.id);
}

ThreadData threadFromPage(ThreadPage page) =>
    ThreadData(messages: page.messages, hasMore: page.hasMore, before: page.messages.isEmpty ? null : page.messages.first.id);

/// An older page goes in front. The server's copy of a row wins over one a
/// broadcast added out of order. Dropped if the thread moved on while it was in
/// flight (another chat, or a refresh that started over).
ThreadData prependOlderPage(ThreadData thread, ThreadPage page, int? requestedBefore) {
  if (thread.before != requestedBefore) return thread;
  final ids = {for (final m in page.messages) m.id};
  final merged = [...page.messages, ...thread.messages.where((m) => !ids.contains(m.id))]..sort(_byTime);
  return ThreadData(messages: merged, hasMore: page.hasMore, before: page.messages.isEmpty ? thread.before : page.messages.first.id);
}

/// The background refresh re-reads the newest page. Its rows replace the thread's
/// from its first row on, so deletes and statuses a missed broadcast never
/// delivered still land, and older pages already scrolled through stay. When the
/// page is the whole thread, or does not reach back to a row already here, it
/// replaces everything.
ThreadData mergeNewestPage(ThreadData thread, ThreadPage page) {
  final fresh = page.messages;
  if (!page.hasMore || fresh.isEmpty || !thread.messages.any((m) => m.id == fresh.first.id)) {
    return threadFromPage(page);
  }
  final ids = {for (final m in fresh) m.id};
  final older = thread.messages.where((m) => !ids.contains(m.id) && _byTime(m, fresh.first) < 0);
  return thread.withMessages([...older, ...fresh]..sort(_byTime));
}

/// The latest reaction from each side of one message.
class Reactions {
  const Reactions({this.customer, this.business});

  final String? customer;
  final String? business;

  bool get isEmpty => customer == null && business == null;
}

class FoldedThread {
  const FoldedThread(this.shown, this._byTarget);

  final List<Message> shown;
  final Map<String, Reactions> _byTarget;

  Reactions? reactionsFor(Message m) => m.metaMessageId == null ? null : _byTarget[m.metaMessageId];
}

/// Reactions are rows of their own, as Meta delivers them. A bubble shows the
/// latest from each side; an empty emoji means it was taken off. A reaction whose
/// message is on a page not loaded yet shows nowhere until that page comes in.
FoldedThread foldReactions(List<Message> messages) {
  final byTarget = <String, Reactions>{};
  final shown = <Message>[];
  for (final m in messages) {
    final target = m.contextWamid;
    if (m.type == 'reaction' && target != null) {
      final was = byTarget[target] ?? const Reactions();
      byTarget[target] = m.isOutbound ? Reactions(customer: was.customer, business: m.body) : Reactions(customer: m.body, business: was.business);
    } else {
      shown.add(m);
    }
  }
  return FoldedThread(shown, byTarget);
}

Map<String, Message> indexByWamid(List<Message> messages) => {
  for (final m in messages)
    if (m.metaMessageId != null) m.metaMessageId!: m,
};

/// What the thread list draws: a day chip, or one message.
sealed class ThreadRow {
  const ThreadRow();
}

class DayRow extends ThreadRow {
  const DayRow(this.at, this.key);
  final String? at;
  final String key;
}

class MessageRow extends ThreadRow {
  const MessageRow(this.message, {required this.startsRun});
  final Message message;

  /// A new sender or a new day: gets a tail and a wider gap.
  final bool startsRun;
}

List<ThreadRow> buildThreadRows(List<Message> messages) {
  final rows = <ThreadRow>[];
  String? lastDay;
  String? lastDirection;
  for (final m in messages) {
    final key = dayKey(m.at);
    if (key != lastDay) {
      rows.add(DayRow(m.at, 'day-$key'));
      lastDay = key;
      lastDirection = null;
    }
    rows.add(MessageRow(m, startsRun: m.direction != lastDirection));
    lastDirection = m.direction;
  }
  return rows;
}

/// The list row's preview: the webhook writes a recognisable stand-in ("📎 image")
/// when media has no caption, and a bracketed token for anything it could not parse.
class ListPreview {
  const ListPreview(this.text, {this.kind});
  final String text;
  final String? kind;
}

final _mediaPreview = RegExp(r'^📎\s*([a-z]+)$', caseSensitive: false);
final _placeholderPreview = RegExp(r'^\[([a-z_\- ]{1,40})\]$', caseSensitive: false);
const _mediaLabels = {'image': 'Photo', 'video': 'Video', 'audio': 'Voice message', 'document': 'Document', 'sticker': 'Sticker'};

ListPreview decodePreview(String? raw) {
  final text = (raw ?? '').trim();
  final media = _mediaPreview.firstMatch(text);
  if (media != null) {
    final key = media.group(1)!.toLowerCase();
    return ListPreview(_mediaLabels[key] ?? key, kind: key);
  }
  final placeholder = _placeholderPreview.firstMatch(text);
  if (placeholder != null) {
    final key = placeholder.group(1)!.toLowerCase();
    if (key == 'interactive' || key == 'button') return const ListPreview('Tapped a button');
    return ListPreview('${key[0].toUpperCase()}${key.substring(1)} message');
  }
  return ListPreview(text);
}

/// The webhook stores a literal "[interactive]" for types it cannot parse. Showing
/// the internal token would look like a bug, so describe the event instead.
const _placeholderLabels = {
  'interactive': 'Tapped a button',
  'button': 'Tapped a button',
  'order': 'Sent an order',
  'location': 'Shared a location',
  'contacts': 'Shared a contact',
  'reaction': 'Reacted to a message',
  'unsupported_message': 'Unsupported message',
};

String? placeholderLabel(String? body) {
  final match = _placeholderPreview.firstMatch(body ?? '');
  if (match == null) return null;
  final name = match.group(1)!.toLowerCase();
  return _placeholderLabels[name.replaceAll(RegExp(r'\s+'), '_')] ?? 'Sent a $name message';
}
