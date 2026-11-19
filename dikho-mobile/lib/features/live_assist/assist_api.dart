import '../../shared/crm_api.dart';

/// Live Assist's routes on the API Worker (src/api/routes/assist/index.js), as
/// assistApi.js calls them. They record who helps whom and tell each side over their
/// private staff channel; every rule (who may help whom, one session per person, time
/// limits) is the database's. The picture and the chat never go this way.
class AssistApi {
  AssistApi(this.api);

  final CrmApi api;

  Future<AssistState> state() async => AssistState(await api.get('/assist/state'));

  Future<AssistSession> start(String employeeId, {String? helpRequestId}) async =>
      AssistSession(await api.post('/assist/sessions', {'employee_id': employeeId, 'help_request_id': helpRequestId}));

  Future<AssistSession> respond(String sessionId, {required bool accept}) async =>
      AssistSession(await api.post('/assist/sessions/$sessionId/respond', {'accept': accept}));

  /// [connectionLost] when the direct connection dropped; else a deliberate stop.
  Future<void> end(String sessionId, {bool connectionLost = false}) =>
      api.post('/assist/sessions/$sessionId/end', {'reason': connectionLost ? 'connection_lost' : null});

  Future<List<AssistHelper>> helpers() async => (await api.getList('/assist/helpers')).map(AssistHelper.new).toList();

  Future<HelpAsked> askHelp(String message, String? section, {String? helperId}) async =>
      HelpAsked(await api.post('/assist/help', {'message': message.isEmpty ? null : message, 'section': section, 'helper_id': helperId}));

  Future<void> cancelHelp(String requestId) => api.post('/assist/help/$requestId/cancel', {});
}

String _text(Object? value) => value is String ? value : '';

Map<String, dynamic> _map(Object? value) => value is Map ? Map<String, dynamic>.from(value) : const {};

/// One Live Assist session, as sessionNotice sends it.
class AssistSession {
  AssistSession(Object? raw) : raw = _map(raw);

  final Map<String, dynamic> raw;

  String get id => _text(raw['id']);
  String get status => _text(raw['status']);
  String get helperId => _text(raw['helper_id']);
  String get helperName => _text(raw['helper_name']);
  String get employeeId => _text(raw['employee_id']);
  String get employeeName => _text(raw['employee_name']);
  DateTime? get expiresAt => DateTime.tryParse(_text(raw['expires_at']));
  String get endReason => _text(raw['end_reason']);
  bool get fromHelpRequest => raw['from_help_request'] == true;

  AssistSession merged(AssistSession other) => AssistSession({...raw, ...other.raw});
}

/// Someone asking for help, as a helper is told.
class HelpRequest {
  HelpRequest(Object? raw) : raw = _map(raw);

  final Map<String, dynamic> raw;

  String get id => _text(raw['id']);
  String get requesterId => _text(raw['requester_id']);
  String get requesterName => _text(raw['requester_name']);
  String get message => _text(raw['message']);
  String get section => _text(raw['section']);

  /// Asked for this helper by name, rather than everyone who can help.
  bool get forYou => raw['for_you'] == true;
}

/// Your own open request for help.
class MyHelp {
  const MyHelp({required this.id, this.expiresAt, this.helperName});

  final String id;
  final DateTime? expiresAt;
  final String? helperName;
}

/// Someone who may help you, for "Who should help?".
class AssistHelper {
  AssistHelper(Object? raw) : raw = _map(raw);

  final Map<String, dynamic> raw;

  String get userId => _text(raw['user_id']);
  String get name => _text(raw['full_name']);
  bool get online => raw['online'] == true;
  bool get busy => raw['busy'] == true;
}

/// What GET /assist/state says is already in flight.
class AssistState {
  AssistState(Object? raw) : raw = _map(raw);

  final Map<String, dynamic> raw;

  AssistSession? get incoming => raw['incoming'] is Map ? AssistSession(raw['incoming']) : null;

  MyHelp? get myHelp {
    final help = _map(raw['my_help_request']);
    final id = _text(help['id']);
    if (id.isEmpty) return null;
    final name = _text(help['helper_name']);
    return MyHelp(id: id, expiresAt: DateTime.tryParse(_text(help['expires_at'])), helperName: name.isEmpty ? null : name);
  }

  List<HelpRequest> get helpRequests => [
    if (raw['help_requests'] is List)
      for (final r in raw['help_requests'] as List) HelpRequest(r),
  ];

  List<AssistSession> get sessions => [
    if (raw['sessions'] is List)
      for (final s in raw['sessions'] as List) AssistSession(s),
  ];
}

/// What POST /assist/help answers.
class HelpAsked {
  HelpAsked(Object? raw) : raw = _map(raw);

  final Map<String, dynamic> raw;

  String get requestId => _text(raw['request_id']);
  bool get alreadyOpen => raw['already_open'] == true;
  DateTime? get expiresAt => DateTime.tryParse(_text(raw['expires_at']));
  String? get helperName => _text(raw['helper_name']).isEmpty ? null : _text(raw['helper_name']);

  /// Null when already open; 0 when nobody can help this person.
  int? get helpersNotified => raw['helpers_notified'] is num ? (raw['helpers_notified'] as num).toInt() : null;
}
