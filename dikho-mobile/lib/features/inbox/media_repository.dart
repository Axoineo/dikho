import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';

import 'dart:convert' show utf8;

/// Media and contact photos, fetched once to private cache storage. Requests carry
/// a short-lived signed ticket, never the session token, and only ever go to the
/// API's own origin: a path from a message row cannot send the ticket elsewhere.
class MediaRepository {
  MediaRepository({required this.origin, required this.fetchTicket, required String cacheDir, HttpClient? httpClient})
    : _dir = Directory('$cacheDir/media'),
      _http = httpClient ?? HttpClient();

  final Uri origin;
  final Future<String> Function() fetchTicket;
  final Directory _dir;
  final HttpClient _http;

  /// Tickets last an hour (the API's MEDIA_TICKET_TTL_SECONDS); a new one is fetched before that.
  static const _ticketLife = Duration(minutes: 45);
  static const _maxFileBytes = 100 * 1024 * 1024;
  static const _maxCacheBytes = 200 * 1024 * 1024;

  String? _ticket;
  DateTime? _ticketAt;
  bool _trimmed = false;
  final _inFlight = <String, Future<File>>{};

  /// The URL for native downloads and sharing. Null for anything that is not a
  /// path on the API's own origin.
  Future<Uri?> urlFor(String path) async {
    if (!_isOwnPath(path)) return null;
    final ticket = await _currentTicket();
    return origin.resolve(path).replace(queryParameters: {'t': ticket});
  }

  bool _isOwnPath(String path) => path.startsWith('/') && !path.startsWith('//') && !path.contains('..');

  Future<String> _currentTicket({bool fresh = false}) async {
    final at = _ticketAt;
    final held = _ticket;
    if (!fresh && held != null && at != null && DateTime.now().difference(at) < _ticketLife) return held;
    final ticket = await fetchTicket();
    _ticket = ticket;
    _ticketAt = DateTime.now();
    return ticket;
  }

  Future<File> fileFor(String path) => _inFlight[path] ??= _load(path).whenComplete(() => _inFlight.remove(path));

  Future<File> _load(String path) async {
    if (!_isOwnPath(path)) throw const HttpException('Not a media path');
    final name = sha1.convert(utf8.encode(path)).toString();
    final file = File('${_dir.path}/$name');
    if (await file.exists() && await file.length() > 0) return file;
    await _dir.create(recursive: true);
    unawaited(_trimOnce());
    final temp = File('${file.path}.part');
    try {
      try {
        await _download(path, temp, await _currentTicket());
      } on _Expired {
        await _download(path, temp, await _currentTicket(fresh: true));
      }
    } on Object {
      if (await temp.exists()) await temp.delete();
      rethrow;
    }
    return temp.rename(file.path);
  }

  Future<void> _download(String path, File target, String ticket) async {
    final request = await _http.getUrl(origin.resolve(path).replace(queryParameters: {'t': ticket}));
    request.followRedirects = false;
    final response = await request.close().timeout(const Duration(seconds: 60));
    if (response.statusCode == HttpStatus.unauthorized || response.statusCode == HttpStatus.forbidden) {
      await response.drain<void>();
      throw const _Expired();
    }
    if (response.statusCode != HttpStatus.ok) {
      await response.drain<void>();
      throw HttpException('Media answered ${response.statusCode}');
    }
    final sink = target.openWrite();
    var received = 0;
    try {
      await for (final chunk in response) {
        received += chunk.length;
        if (received > _maxFileBytes) throw const HttpException('Media is too large');
        sink.add(chunk);
      }
    } finally {
      await sink.close();
    }
  }

  /// Oldest files go first, once per run, and only past a generous ceiling.
  Future<void> _trimOnce() async {
    if (_trimmed) return;
    _trimmed = true;
    try {
      final files = await _dir.list().where((e) => e is File).cast<File>().toList();
      final stats = <(File, FileStat)>[];
      var total = 0;
      for (final file in files) {
        final stat = await file.stat();
        stats.add((file, stat));
        total += stat.size;
      }
      if (total <= _maxCacheBytes) return;
      stats.sort((a, b) => a.$2.modified.compareTo(b.$2.modified));
      for (final (file, stat) in stats) {
        if (total <= _maxCacheBytes) break;
        await file.delete();
        total -= stat.size;
      }
    } on IOException {
      // Android clears the cache directory itself when it needs the space.
    }
  }

  void close() => _http.close(force: true);

  /// Everything fetched for the person who just signed out. Downloads still running
  /// are cut off first, so nothing lands here afterwards.
  Future<void> wipe() async {
    close();
    _ticket = null;
    _ticketAt = null;
    try {
      if (await _dir.exists()) await _dir.delete(recursive: true);
    } on IOException {
      // Cache storage: Android reclaims it, and the next sign-in reuses nothing
      // without a fresh ticket. Nothing more can be done here.
    }
  }
}

class _Expired implements Exception {
  const _Expired();
}
