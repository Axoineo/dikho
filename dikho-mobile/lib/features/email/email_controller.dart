import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../shared/crm_api.dart';
import 'email_api.dart';
import 'email_models.dart';

/// The email inbox's state, as EmailInbox.jsx keeps it: which folder and mailbox, the
/// search, a page of conversations at a time, and a quiet refresh while it is open
/// (the server syncs the mailboxes on the way, so new mail appears by itself).
class EmailInboxController extends ChangeNotifier {
  EmailInboxController({required this.api, DateTime Function()? now, this.refreshEvery = const Duration(seconds: 60), this.pageSize = 30})
    : now = now ?? DateTime.now;

  final EmailApi api;
  final DateTime Function() now;
  final Duration refreshEvery;
  final int pageSize;

  List<Mailbox>? mailboxes;
  String? mailboxError;

  String folder = 'inbox';
  String? mailboxId;
  String search = '';
  bool unreadOnly = false;

  List<ThreadSummary> threads = [];
  bool hasMore = false;
  bool loading = false;
  String? error;

  /// The rows are the provider's own search results (Gmail), not Dikho's synced list.
  bool providerResults = false;

  Timer? _refresh;
  int _generation = 0;
  bool _disposed = false;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Mailbox? get mailbox {
    for (final m in mailboxes ?? const <Mailbox>[]) {
      if (m.id == mailboxId) return m;
    }
    return null;
  }

  /// May write from at least one connected mailbox.
  bool get writable => (mailboxes ?? const []).any((m) => m.writable);

  int get unreadTotal => (mailboxes ?? const <Mailbox>[]).fold(0, (n, m) => n + m.unread);

  /// The provider's own search needs one mailbox that supports it.
  bool get canSearchProvider => mailbox != null && mailbox!.can('search') && search.isNotEmpty && !providerResults;

  Future<void> start() async {
    await Future.wait([loadMailboxes(), load()]);
  }

  /// Refreshes quietly while the inbox is on screen.
  void watch() {
    _refresh ??= Timer.periodic(refreshEvery, (_) {
      if (providerResults) return;
      unawaited(load(quiet: true));
      unawaited(loadMailboxes());
    });
  }

  void unwatch() {
    _refresh?.cancel();
    _refresh = null;
  }

  Future<void> loadMailboxes() async {
    try {
      mailboxes = await api.mailboxes();
      mailboxError = null;
    } on ApiException catch (failure) {
      mailboxError = failure.message;
    }
    _notify();
  }

  Future<void> load({bool more = false, bool quiet = false}) async {
    final generation = more ? _generation : ++_generation;
    if (!quiet) {
      loading = true;
      error = null;
      _notify();
    }
    try {
      final (rows, more_) = await api.threads(
        folder: folder,
        mailbox: mailboxId,
        unread: unreadOnly,
        search: search,
        before: more && threads.isNotEmpty ? threads.last : null,
        limit: pageSize,
      );
      // A newer request (another folder, search or mailbox) has taken over.
      if (generation != _generation) return;
      threads = more ? [...threads, ...rows] : rows;
      hasMore = more_;
      providerResults = false;
      error = null;
    } on ApiException catch (failure) {
      if (generation == _generation && !quiet) error = failure.message;
    } finally {
      if (generation == _generation) loading = false;
      _notify();
    }
  }

  Future<void> searchProvider() async {
    final box = mailboxId;
    if (box == null || search.isEmpty) return;
    final generation = ++_generation;
    loading = true;
    error = null;
    _notify();
    try {
      final rows = await api.searchProvider(box, search);
      if (generation != _generation) return;
      threads = rows;
      hasMore = false;
      providerResults = true;
    } on ApiException catch (failure) {
      if (generation == _generation) error = failure.message;
    } finally {
      if (generation == _generation) loading = false;
      _notify();
    }
  }

  void setFolder(String value) {
    if (value == folder) return;
    folder = value;
    unawaited(load());
  }

  void setMailbox(String? value) {
    if (value == mailboxId) return;
    mailboxId = value;
    unawaited(load());
  }

  void setSearch(String value) {
    final clean = value.trim();
    if (clean == search) return;
    search = clean.length > 100 ? clean.substring(0, 100) : clean;
    unawaited(load());
  }

  void setUnreadOnly(bool value) {
    if (value == unreadOnly) return;
    unreadOnly = value;
    unawaited(load());
  }

  /// Keeps the list in step with what happened in an open conversation.
  void patch(String id, Map<String, dynamic> changes) {
    threads = [for (final t in threads) t.id == id ? t.patched(changes) : t];
    _notify();
  }

  void drop(String id) {
    threads = [
      for (final t in threads)
        if (t.id != id) t,
    ];
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    unwatch();
    super.dispose();
  }
}
