import 'dart:async';

import 'package:flutter/foundation.dart';

import 'crm_api.dart';
import 'supabase_rest.dart';

/// A table read a page at a time from Supabase, with a server search that waits for
/// typing to stop. Native list screens share this, so paging, search and failures work
/// the same in every module.
abstract class PagedRows<T> extends ChangeNotifier {
  PagedRows({
    required this.rest,
    required this.table,
    required this.order,
    this.select = '*',
    this.pageSize = 25,
    this.searchDelay = const Duration(milliseconds: 300),
  });

  final SupabaseRest rest;
  final String table;

  /// PostgREST's `order`, ending in a unique column so pages never overlap.
  final String order;

  /// PostgREST's `select`, with embedded tables where a screen needs them.
  final String select;
  final int pageSize;
  final Duration searchDelay;

  List<T> rows = const [];
  int? total;
  bool loading = false;
  bool loadingMore = false;
  String? error;
  String query = '';

  bool _hasMore = false;
  bool _disposed = false;
  int _request = 0;
  Timer? _searchTimer;

  bool get hasMore => _hasMore;

  /// One row from the table.
  T parse(Map<String, dynamic> row);

  /// What makes two rows the same, so a row that moved between pages appears once.
  String idOf(T row);

  /// PostgREST's `or` filter for a search, without its brackets. Null for no filter.
  String? searchFilter(String query);

  /// Column filters on top of the search, such as {'status': 'eq.1'}.
  @protected
  Map<String, String> get filters => const {};

  /// What a page needs from elsewhere before it shows, such as which sales order each
  /// purchase order is for. A failure here must not lose the page: return it as it is.
  @protected
  Future<List<T>> withExtras(List<T> page) async => page;

  /// The filters changed: start again from the first page.
  @protected
  void filtersChanged() {
    _searchTimer?.cancel();
    unawaited(reload());
  }

  @protected
  void notify() {
    if (!_disposed) notifyListeners();
  }

  void setQuery(String value) {
    final next = value.trim();
    if (next == query) return;
    query = next;
    _searchTimer?.cancel();
    _searchTimer = Timer(searchDelay, () => unawaited(reload()));
    notify();
  }

  Map<String, String> get _params {
    final filter = query.isEmpty ? null : searchFilter(query);
    return {'select': select, 'order': order, if (filter != null) 'or': '($filter)', ...filters};
  }

  Future<void> reload() async {
    final request = ++_request;
    loading = true;
    error = null;
    notify();
    try {
      final page = await rest.select(table, query: _params, from: 0, to: pageSize - 1, countAll: true);
      final parsed = await withExtras(page.rows.map(parse).toList());
      if (request != _request || _disposed) return;
      rows = parsed;
      total = page.total;
      _hasMore = total == null ? page.rows.length == pageSize : rows.length < total!;
    } on ApiException catch (failure) {
      if (request != _request) return;
      // The rows held are for the previous search, so they must not look like this one's.
      error = failure.message;
      rows = const [];
      total = null;
      _hasMore = false;
    } finally {
      if (request == _request) {
        loading = false;
        notify();
      }
    }
  }

  Future<void> loadMore() async {
    if (!_hasMore || loading || loadingMore) return;
    final request = _request;
    loadingMore = true;
    notify();
    try {
      final from = rows.length;
      final page = await rest.select(table, query: _params, from: from, to: from + pageSize - 1);
      final parsed = await withExtras(page.rows.map(parse).toList());
      if (request != _request || _disposed) return;
      // A row arriving meanwhile shifts the pages by one: never show it twice.
      final have = {for (final row in rows) idOf(row)};
      rows = [...rows, ...parsed.where((row) => !have.contains(idOf(row)))];
      _hasMore = page.rows.length == pageSize && (total == null || rows.length < total!);
    } on ApiException {
      // The next scroll tries again.
    } finally {
      loadingMore = false;
      notify();
    }
  }

  /// A row saved on this phone, shown at once: an edit in place, a new row on top.
  void upsert(T row) {
    final id = idOf(row);
    final index = rows.indexWhere((r) => idOf(r) == id);
    if (index >= 0) {
      rows = [...rows]..[index] = row;
    } else {
      rows = [row, ...rows];
      if (total != null) total = total! + 1;
    }
    notify();
  }

  @override
  void dispose() {
    _disposed = true;
    _searchTimer?.cancel();
    super.dispose();
  }
}
