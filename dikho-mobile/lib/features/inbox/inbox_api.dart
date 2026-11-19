import 'dart:io';

import '../../shared/crm_api.dart';
import 'inbox_models.dart';

class ConversationPage {
  const ConversationPage({required this.conversations, this.nextCursor, this.unreadTotal});

  final List<Conversation> conversations;
  final String? nextCursor;
  final int? unreadTotal;
}

/// Approved template, as GET /api/templates lists it.
class ChatTemplate {
  ChatTemplate(this.raw);

  final Map<String, dynamic> raw;

  String get name => raw['name'] as String? ?? '';
  String get language => raw['language'] as String? ?? '';
  String get category => raw['category'] as String? ?? '';
  String get bodyText => raw['bodyText'] as String? ?? '';
  String get headerText => raw['headerText'] as String? ?? '';
  String get footerText => raw['footerText'] as String? ?? '';
  String? get headerFormat => raw['headerFormat'] as String?;
  List<String> get variables => [
    for (final v in raw['variables'] as List? ?? const [])
      if (v is String) v,
  ];

  /// The app fills in text variables only, as the inbox does. A media header or a
  /// link button with a variable needs a value it cannot collect (the API refuses).
  bool get usable {
    if (category == 'AUTHENTICATION') return false;
    if (headerFormat != null && headerFormat != 'TEXT') return false;
    for (final b in raw['buttons'] as List? ?? const []) {
      if (b is Map && (b['url'] as String? ?? '').contains('{{')) return false;
    }
    return true;
  }

  String preview(Map<String, String> values) => bodyText.replaceAllMapped(RegExp(r'\{\{\s*([\w.\- ]+?)\s*\}\}'), (m) {
    final filled = (values[m.group(1)!.trim()] ?? '').trim();
    return filled.isEmpty ? m.group(0)! : filled;
  });
}

/// Every inbox call. Each is checked by the API against the person's permissions;
/// nothing here decides who may do what.
class InboxApi {
  InboxApi(this._api);

  final CrmApi _api;

  static const threadPageSize = 50;
  static const listPageSize = 30;

  String _chat(int id) => '/whatsapp/conversations/$id';

  Future<ConversationPage> conversations({String? cursor, String query = '', bool unreadOnly = false}) async {
    final data = await _api.get(
      '/whatsapp/conversations',
      query: {'limit': '$listPageSize', 'cursor': ?cursor, if (query.isNotEmpty) 'q': query, if (unreadOnly) 'unread': '1'},
    );
    return ConversationPage(
      conversations: [
        for (final row in data['conversations'] as List? ?? const [])
          if (row is Map<String, dynamic>) Conversation(row),
      ],
      nextCursor: data['nextCursor'] as String?,
      unreadTotal: data['unreadTotal'] as int?,
    );
  }

  Future<ThreadPage> messages(int id, {int? before}) async =>
      ThreadPage.fromJson(await _api.get('${_chat(id)}/messages', query: {'limit': '$threadPageSize', if (before != null) 'before': '$before'}));

  Future<void> markRead(int id) => _api.post('${_chat(id)}/read');
  Future<void> typing(int id) => _api.post('${_chat(id)}/typing');

  Message _message(Map<String, dynamic> data) => Message(data['message'] as Map<String, dynamic>);

  Future<Message> sendText(int id, String body, {int? replyTo}) async =>
      _message(await _api.post('${_chat(id)}/messages', {'body': body, 'replyTo': replyTo}));

  Future<Message> sendMedia(
    int id, {
    required File file,
    required String filename,
    required String mime,
    String caption = '',
    int? replyTo,
    bool voice = false,
  }) async => _message(
    await _api.upload(
      '${_chat(id)}/media',
      file: file,
      filename: filename,
      mime: mime,
      fields: {if (caption.isNotEmpty) 'caption': caption, if (replyTo != null) 'replyTo': '$replyTo', if (voice) 'voice': '1'},
    ),
  );

  Future<String?> uploadAvatar(int id, {required File file, required String filename, required String mime}) async {
    final data = await _api.upload('${_chat(id)}/avatar', file: file, filename: filename, mime: mime);
    return data['avatar_url'] as String?;
  }

  Future<String> mediaTicket() async => (await _api.get('/whatsapp/media-ticket'))['ticket'] as String;

  Future<Message> sendLocation(int id, Map<String, Object?> input) async => _message(await _api.post('${_chat(id)}/location', input));
  Future<Message> sendContact(int id, Map<String, Object?> input) async => _message(await _api.post('${_chat(id)}/contact', input));
  Future<Message> sendInteractive(int id, Map<String, Object?> input) async => _message(await _api.post('${_chat(id)}/interactive', input));
  Future<Message> sendTemplate(int id, Map<String, Object?> input) async => _message(await _api.post('${_chat(id)}/template', input));

  /// To a phone number, possibly with no chat yet. Returns the chat's id.
  Future<int?> sendTemplateToPhone(String phone, {required String name, required String language, required Map<String, String> values}) async {
    final data = await _api.post('/whatsapp/conversations/template', {'phone': phone, 'name': name, 'language': language, 'values': values});
    return data['conversationId'] as int?;
  }

  Future<List<ChatTemplate>> templates() async {
    final data = await _api.get('/templates');
    return [
      for (final row in data['templates'] as List? ?? const [])
        if (row is Map<String, dynamic>) ChatTemplate(row),
    ];
  }

  Future<Message> react(int id, int messageId, String emoji) async =>
      _message(await _api.post('${_chat(id)}/messages/$messageId/reaction', {'emoji': emoji}));
  Future<Message> pin(int id, int messageId) async => _message(await _api.post('${_chat(id)}/messages/$messageId/pin'));
  Future<Message> unpin(int id, int messageId) async => _message(await _api.delete('${_chat(id)}/messages/$messageId/pin'));
  Future<void> star(int id, int messageId) => _api.post('${_chat(id)}/messages/$messageId/star');
  Future<void> unstar(int id, int messageId) => _api.delete('${_chat(id)}/messages/$messageId/star');
  Future<void> deleteMessage(int id, int messageId) => _api.delete('${_chat(id)}/messages/$messageId');
  Future<Message> forward(int targetId, int messageId) async => _message(await _api.post('${_chat(targetId)}/forward', {'messageId': messageId}));

  Future<Conversation> clearChat(int id) async => Conversation((await _api.post('${_chat(id)}/clear'))['conversation'] as Map<String, dynamic>);
  Future<void> deleteChat(int id) => _api.delete(_chat(id));
  Future<String?> block(int id) async => ((await _api.post('${_chat(id)}/block'))['conversation'] as Map?)?['blocked_at'] as String?;
  Future<void> unblock(int id) => _api.delete('${_chat(id)}/block');
}
