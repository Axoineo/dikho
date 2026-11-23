import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../shared/crm_api.dart';
import 'contacts_models.dart';

/// The contacts list a page at a time, with a server search that waits for typing to
/// stop, as the web Contacts page reads it. Kept for the session, so coming back shows
/// the last list at once.
class ContactsController extends ChangeNotifier {
  ContactsController(this.api, {this.pageSize = 30, this.searchDelay = const Duration(milliseconds: 300)});

  final CrmApi api;
  final int pageSize;
  final Duration searchDelay;

  List<WaContact> contacts = const [];
  int? total;
  bool loading = false;
  bool loadingMore = false;
  bool deleting = false;
  String? error;
  String query = '';

  String? _cursor;
  int _request = 0;
  bool _disposed = false;
  Timer? _searchTimer;

  bool get hasMore => _cursor != null;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Map<String, String> _params({String? cursor}) => {'limit': '$pageSize', 'search': query, 'cursor': ?cursor};

  Future<void> start() => reload();

  /// Reloads in place: the rows stay on screen until the new first page arrives.
  Future<void> refresh() => reload();

  bool _pulled = false;

  /// A search or a return to the screen is reloading rows that are still on screen.
  /// A pull to refresh shows its own spinner, so it is left out.
  bool get refreshing => loading && contacts.isNotEmpty && !_pulled;

  /// The reload behind a pull to refresh.
  Future<void> pullToRefresh() async {
    _pulled = true;
    try {
      await reload();
    } finally {
      _pulled = false;
    }
  }

  void setQuery(String value) {
    final next = value.trim();
    if (next == query) return;
    query = next.length > 80 ? next.substring(0, 80) : next;
    _searchTimer?.cancel();
    _searchTimer = Timer(searchDelay, () => unawaited(reload()));
    _notify();
  }

  Future<void> reload() async {
    final request = ++_request;
    loading = true;
    error = null;
    _notify();
    try {
      final page = ContactPage.from(await api.get('/contacts', query: _params()));
      if (request != _request || _disposed) return;
      contacts = page.contacts;
      total = page.total ?? page.contacts.length;
      _cursor = page.nextCursor;
    } on ApiException catch (failure) {
      if (request != _request) return;
      // The rows held belong to the previous search, so they must not look like this one's.
      error = failure.message;
      contacts = const [];
      total = null;
      _cursor = null;
    } finally {
      if (request == _request) {
        loading = false;
        _notify();
      }
    }
  }

  Future<void> loadMore() async {
    final cursor = _cursor;
    if (cursor == null || loading || loadingMore) return;
    final request = _request;
    loadingMore = true;
    _notify();
    try {
      final page = ContactPage.from(await api.get('/contacts', query: _params(cursor: cursor)));
      if (request != _request || _disposed) return;
      final seen = {for (final c in contacts) c.id};
      contacts = [...contacts, ...page.contacts.where((c) => !seen.contains(c.id))];
      _cursor = page.nextCursor;
    } on ApiException catch (failure) {
      if (request == _request) error = failure.message;
    } finally {
      loadingMore = false;
      _notify();
    }
  }

  /// Deletes these contacts for good, then reloads. Their chats and messages keep
  /// their history (the API unlinks them). Throws ApiException when refused.
  Future<void> delete(Iterable<int> ids) async {
    final list = ids.where((id) => id > 0).toSet().toList();
    if (list.isEmpty) return;
    await _deleting(() => api.delete('/contacts', {'contactIds': list}));
  }

  /// Deletes every contact, as "Delete all" on the web page does.
  Future<void> deleteAll() => _deleting(() => api.delete('/contacts', {'all': true}));

  Future<void> _deleting(Future<Object?> Function() send) async {
    deleting = true;
    _notify();
    try {
      await send();
    } finally {
      deleting = false;
      _notify();
    }
    await reload();
  }

  @override
  void dispose() {
    _disposed = true;
    _searchTimer?.cancel();
    super.dispose();
  }
}
