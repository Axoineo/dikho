import '../../shared/crm_api.dart';
import '../../shared/paged_rows.dart';
import 'clients_models.dart';

/// The client list, newest first, and saving one. RLS decides who may add or change a
/// client (clients.create, clients.edit); the screens only choose what to offer.
class ClientsController extends PagedRows<Client> {
  ClientsController({required super.rest, super.pageSize, super.searchDelay}) : super(table: 'clients', order: 'id.desc');

  Object? _settings;
  bool _settingsLoaded = false;

  @override
  Client parse(Map<String, dynamic> row) => Client(row);

  @override
  String idOf(Client row) => row.id;

  @override
  String? searchFilter(String query) => clientSearchFilter(query);

  Future<void> start() => reload();

  /// Settings changed a list: the form loads it again when it next opens.
  void settingsChanged() => _settingsLoaded = false;

  /// For the form's registration list. Without it, the built-in list is offered.
  Future<List<String>> registrations(String current) async {
    if (!_settingsLoaded) {
      try {
        _settings = await rest.rpc('get_settings');
        _settingsLoaded = true;
      } on ApiException {
        // The defaults stand in until the next try.
      }
    }
    return registrationOptions(_settings, current);
  }

  /// Adds a client, or changes [existing], and shows the result in the list at once.
  Future<Client> save(Client? existing, ClientDraft draft) async {
    final payload = draft.toPayload();
    final stored = existing == null ? await rest.insert('clients', payload) : await rest.update('clients', id: existing.id, patch: payload);
    final client = Client(stored);
    upsert(client);
    return client;
  }
}
