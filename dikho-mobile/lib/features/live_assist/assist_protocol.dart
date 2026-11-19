import 'dart:math';

/// Live Assist's messages and chat, as src/features/live-assist/chat.js has them, so a
/// phone and a browser accept exactly the same things. They travel on the session's
/// data channel, directly between the two devices; nothing here is stored or passes
/// through Dikho's servers, and all of it is gone when the session ends.
///
/// Helper to employee: chat, note (pinned at a spot), note_remove, typing, pointer,
/// pointer_hide, highlight, goto.
/// Employee to helper: chat, note_done (tapped or dismissed), notes_cleared (they
/// changed screen), typing, section.

const maxChat = 500;
const maxNote = 140;
const maxNotes = 5;
const maxThread = 100;

/// How long "is typing" shows after the last keystroke signal.
const typingFor = Duration(seconds: 4);

const helperPhrases = ['Tap here', 'Type here', 'Scroll down', 'Wait a moment', 'Well done'];
const employeeReplies = ['OK', 'Done', 'Where?', 'One moment'];

/// Why a session ended, in plain words, as END_MESSAGES on the web.
const endMessages = {
  'declined': 'They chose not to share their screen.',
  'expired': 'They did not answer in time.',
  'cancelled': 'You cancelled the request.',
  'superseded': 'This request was replaced by a newer one.',
  'helper_ended': 'You ended Live Assist.',
  'employee_ended': 'They stopped sharing their screen.',
  'connection_lost': 'The connection was lost.',
  'time_limit': 'Live Assist stops after two hours.',
  'access_changed': "Live Assist was stopped because someone's access changed.",
  'no_connection': 'Could not connect directly to their device. Some office or mobile networks block this; try from another network.',
  'signal_failed': 'Could not open the private channel for this session.',
  'busy': 'They are in another Live Assist session right now.',
};

final _id = RegExp(r'^[a-z0-9]{8,32}$');
final _random = Random.secure();

/// 16 lowercase letters and digits, as newId on the web.
String newMessageId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return List.generate(16, (_) => chars[_random.nextInt(chars.length)]).join();
}

/// Plain text only: no control characters, runs of spaces collapsed, at most two line
/// breaks in a row, trimmed to [max]. Shown as text, never as markup.
String cleanText(Object? value, int max) {
  if (value is! String) return '';
  var text = value.replaceAll(RegExp(r'\r\n?'), '\n').replaceAll('\t', ' ');
  text = text.replaceAll(RegExp(r'[\x00-\x09\x0B-\x1F\x7F-\x9F]'), '');
  text = text.replaceAll(RegExp(r' {2,}'), ' ').replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
  return text.length > max ? text.substring(0, max) : text;
}

bool _inRange(Object? v) => v is num && v.isFinite && v >= 0 && v <= 1;

/// A spot on the shared screen, each side 0 to 1 from the top left.
class Spot {
  const Spot(this.x, this.y);

  final double x;
  final double y;

  @override
  bool operator ==(Object other) => other is Spot && other.x == x && other.y == y;

  @override
  int get hashCode => Object.hash(x, y);
}

sealed class AssistMessage {
  const AssistMessage();

  Map<String, Object?> toJson();
}

class ChatText extends AssistMessage {
  const ChatText(this.id, this.text);

  final String id;
  final String text;

  @override
  Map<String, Object?> toJson() => {'t': 'chat', 'id': id, 'text': text};
}

class NotePin extends AssistMessage {
  const NotePin({required this.id, required this.n, required this.text, required this.x, required this.y});

  final String id;
  final int n;
  final String text;
  final double x;
  final double y;

  @override
  Map<String, Object?> toJson() => {'t': 'note', 'id': id, 'n': n, 'text': text, 'x': x, 'y': y};
}

class NoteRemove extends AssistMessage {
  const NoteRemove(this.id);

  /// A note's id, or 'all'.
  final String id;

  @override
  Map<String, Object?> toJson() => {'t': 'note_remove', 'id': id};
}

class NoteDone extends AssistMessage {
  const NoteDone(this.id, this.how);

  final String id;

  /// 'clicked' (the web's word, kept on the wire) or 'dismissed'.
  final String how;

  @override
  Map<String, Object?> toJson() => {'t': 'note_done', 'id': id, 'how': how};
}

class NotesCleared extends AssistMessage {
  const NotesCleared();

  @override
  Map<String, Object?> toJson() => {'t': 'notes_cleared'};
}

class Typing extends AssistMessage {
  const Typing();

  @override
  Map<String, Object?> toJson() => {'t': 'typing'};
}

class PointerAt extends AssistMessage {
  const PointerAt(this.spot);

  final Spot spot;

  @override
  Map<String, Object?> toJson() => {'t': 'pointer', 'x': spot.x, 'y': spot.y};
}

class PointerHide extends AssistMessage {
  const PointerHide();

  @override
  Map<String, Object?> toJson() => {'t': 'pointer_hide'};
}

class HighlightAt extends AssistMessage {
  const HighlightAt(this.spot);

  final Spot spot;

  @override
  Map<String, Object?> toJson() => {'t': 'highlight', 'x': spot.x, 'y': spot.y};
}

class GoTo extends AssistMessage {
  const GoTo(this.path);

  final String path;

  @override
  Map<String, Object?> toJson() => {'t': 'goto', 'path': path};
}

class SectionIs extends AssistMessage {
  const SectionIs(this.section);

  final String? section;

  @override
  Map<String, Object?> toJson() => {'t': 'section', 'section': section};
}

ChatText? _readChat(Map m) {
  final text = cleanText(m['text'], maxChat);
  final id = m['id'];
  return text.isNotEmpty && id is String && _id.hasMatch(id) ? ChatText(id, text) : null;
}

final _path = RegExp(r'^/[a-z0-9/-]{0,60}$');
final _section = RegExp(r'^[a-z][a-z0-9-]{0,39}$');

/// A message from the helper, as the employee's device accepts it, or null.
AssistMessage? readHelperMessage(Object? m) {
  if (m is! Map) return null;
  switch (m['t']) {
    case 'chat':
      return _readChat(m);
    case 'note':
      final text = cleanText(m['text'], maxNote);
      final id = m['id'];
      final n = m['n'];
      final ok = text.isNotEmpty && id is String && _id.hasMatch(id) && _inRange(m['x']) && _inRange(m['y']) && n is int && n >= 1 && n <= 99;
      return ok ? NotePin(id: id, n: n, text: text, x: (m['x'] as num).toDouble(), y: (m['y'] as num).toDouble()) : null;
    case 'note_remove':
      final id = m['id'];
      return id is String && (id == 'all' || _id.hasMatch(id)) ? NoteRemove(id) : null;
    case 'typing':
      return const Typing();
    case 'pointer':
      return _inRange(m['x']) && _inRange(m['y']) ? PointerAt(Spot((m['x'] as num).toDouble(), (m['y'] as num).toDouble())) : null;
    case 'pointer_hide':
      return const PointerHide();
    case 'highlight':
      return _inRange(m['x']) && _inRange(m['y']) ? HighlightAt(Spot((m['x'] as num).toDouble(), (m['y'] as num).toDouble())) : null;
    case 'goto':
      final path = m['path'];
      return path is String && _path.hasMatch(path) ? GoTo(path) : null;
    default:
      return null;
  }
}

/// A message from the employee, as the helper's device accepts it, or null.
AssistMessage? readEmployeeMessage(Object? m) {
  if (m is! Map) return null;
  switch (m['t']) {
    case 'chat':
      return _readChat(m);
    case 'note_done':
      final id = m['id'];
      return id is String && _id.hasMatch(id) ? NoteDone(id, m['how'] == 'clicked' ? 'clicked' : 'dismissed') : null;
    case 'notes_cleared':
      return const NotesCleared();
    case 'typing':
      return const Typing();
    case 'section':
      final section = m['section'];
      if (section == null) return const SectionIs(null);
      return section is String && _section.hasMatch(section) ? SectionIs(section) : null;
    default:
      return null;
  }
}

/// The helper's outgoing message: a note pinned at [pin], or plain chat.
AssistMessage? helperMessage(String text, Spot? pin, int nextNote) {
  final clean = cleanText(text, maxChat);
  if (clean.isEmpty) return null;
  if (pin != null && clean.length <= maxNote) return NotePin(id: newMessageId(), n: nextNote, text: clean, x: pin.x, y: pin.y);
  return ChatText(newMessageId(), clean);
}

ChatText? chatMessage(String text) {
  final clean = cleanText(text, maxChat);
  return clean.isEmpty ? null : ChatText(newMessageId(), clean);
}

/* ── One side's conversation ──────────────────────────────────────────────── */

/// A line in the thread: mine or theirs, chat or a note with where it stands.
class ThreadEntry {
  const ThreadEntry({required this.id, required this.mine, required this.text, required this.at, this.note, this.status});

  final String id;
  final bool mine;
  final String text;
  final DateTime at;

  /// The note's number, for a note.
  final int? note;

  /// For a note: pinned, clicked, dismissed, removed or cleared.
  final String? status;

  bool get isNote => note != null;

  ThreadEntry withStatus(String value) => ThreadEntry(id: id, mine: mine, text: text, at: at, note: note, status: value);
}

/// What the web's chatReducer keeps: the thread, the notes on the employee's screen,
/// unread count, whether the chat is open, the newest unanswered message, typing.
class AssistChat {
  List<ThreadEntry> messages = [];
  List<NotePin> notes = [];
  int unread = 0;
  bool open = false;
  ThreadEntry? peek;
  DateTime? typingAt;
  int nextNote = 1;

  void reset() {
    messages = [];
    notes = [];
    unread = 0;
    open = false;
    peek = null;
    typingAt = null;
    nextNote = 1;
  }

  List<ThreadEntry> _capped(List<ThreadEntry> list) => list.length > maxThread ? list.sublist(list.length - maxThread) : list;

  void _setStatus(bool Function(ThreadEntry) match, String status) {
    messages = [for (final m in messages) m.isNote && m.status == 'pinned' && match(m) ? m.withStatus(status) : m];
  }

  bool typing(DateTime now) => typingAt != null && now.difference(typingAt!) < typingFor;

  void receive(AssistMessage m, DateTime now) {
    switch (m) {
      case Typing():
        typingAt = now;
      case ChatText(:final id, :final text):
        if (messages.any((x) => x.id == id)) return;
        final entry = ThreadEntry(id: id, mine: false, text: text, at: now);
        messages = _capped([...messages, entry]);
        unread = open ? 0 : unread + 1;
        peek = open ? null : entry;
        typingAt = null;
      case NotePin():
        if (messages.any((x) => x.id == m.id)) return;
        var list = [...notes, m];
        messages = [...messages, ThreadEntry(id: m.id, mine: false, text: m.text, at: now, note: m.n, status: 'pinned')];
        if (list.length > maxNotes) {
          final gone = {for (final n in list.sublist(0, list.length - maxNotes)) n.id};
          list = list.sublist(list.length - maxNotes);
          _setStatus((x) => gone.contains(x.id), 'removed');
        }
        notes = list;
        messages = _capped(messages);
        typingAt = null;
      case NoteRemove(:final id):
        bool hit(String x) => id == 'all' || x == id;
        notes = notes.where((n) => !hit(n.id)).toList();
        _setStatus((x) => hit(x.id), 'removed');
      case NoteDone(:final id, :final how):
        _setStatus((x) => x.id == id, how);
      case NotesCleared():
        _setStatus((_) => true, 'cleared');
        nextNote = 1;
      default:
        break;
    }
  }

  /// My own message, already handed to the data channel.
  void sent(AssistMessage m, DateTime now) {
    switch (m) {
      case NotePin():
        messages = _capped([...messages, ThreadEntry(id: m.id, mine: true, text: m.text, at: now, note: m.n, status: 'pinned')]);
        nextNote = m.n + 1;
      case ChatText(:final id, :final text):
        messages = _capped([...messages, ThreadEntry(id: id, mine: true, text: text, at: now)]);
      default:
        return;
    }
    peek = null;
    unread = 0;
  }

  /// Employee side: a note answered on their screen.
  void noteDone(String id, String how) {
    notes = notes.where((n) => n.id != id).toList();
    _setStatus((x) => x.id == id, how);
  }

  /// Employee side: they moved to another screen, where the spots mean nothing.
  void clearNotes() {
    notes = [];
    _setStatus((_) => true, 'cleared');
  }

  /// Helper side: "Remove notes".
  void removeNotes() {
    _setStatus((_) => true, 'removed');
    nextNote = 1;
  }

  void setOpen(bool value) {
    open = value;
    if (value) {
      unread = 0;
      peek = null;
    }
  }
}

/// A note's state in the helper's thread, in words.
String helperNoteStatus(String? status) => switch (status) {
  'clicked' => 'Done',
  'dismissed' => 'Hidden by them',
  'removed' => 'Removed',
  'cleared' => 'Gone: they changed screen',
  _ => 'On their screen',
};

/// A note's state in the employee's thread, in words.
String employeeNoteStatus(String? status) => switch (status) {
  'clicked' => 'Done',
  'dismissed' => 'Hidden',
  'removed' => 'Removed',
  'cleared' => 'Gone: you changed screen',
  _ => 'On your screen',
};

/// A first name for short sentences: "Asha" from "Asha Rao".
String firstName(String? name, {String fallback = 'them'}) {
  final words = (name ?? '').trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
  return words.isEmpty ? fallback : words.first;
}

/// The web's staffRank: Live Assist is offered for people at your level or below.
int staffRank(String role, String developerLevel) {
  if (role == 'owner') return 40;
  if (developerLevel.isNotEmpty) return 30;
  if (role == 'admin') return 20;
  if (role == 'manager') return 10;
  return 0;
}
