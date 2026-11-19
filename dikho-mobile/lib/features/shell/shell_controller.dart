import 'dart:async';

import 'package:flutter/material.dart';

import 'shell_messages.dart';

/// What the app knows about the page: who is signed in, what they may open, which
/// page is showing. The page is the only source; this keeps the latest it said.
class ShellController extends ChangeNotifier {
  ShellController({DateTime Function()? now}) : _now = now ?? DateTime.now;

  final DateTime Function() _now;

  // Scripts are fixed strings with at most an integer in them: nothing from a page
  // or a message is ever put into one.
  Future<void> Function(String script)? _runScript;

  /// From the page's access message; [_nativeAccess] from the app's own my_access.
  ShellAccess? _pageAccess;
  ShellAccess? _nativeAccess;
  String _route = '/';
  bool _pageReady = false;
  bool _dark = false;
  bool _themeKnown = false;
  bool _sessionWarning = false;

  DateTime? _lastActivityReport;
  String? _signOutReason;

  final _openScreen = StreamController<String>.broadcast();

  /// The app's own access check when it has one (ADR 0013), with Live Assist's state,
  /// which only the page knows for now; else what an older page reported.
  ShellAccess? get access {
    final native = _nativeAccess;
    final page = _pageAccess;
    if (native == null) return page;
    final offered = _helpOffered ?? page?.helpOffered;
    if (offered == null) return native;
    return native.withHelp(offered: offered, requested: _helpRequested ?? page?.helpRequested ?? false);
  }

  /// Live Assist's state from the app's own Live Assist, which replaces the page's.
  bool? _helpOffered;
  bool? _helpRequested;

  void setNativeHelp({required bool offered, required bool requested}) {
    if (offered == _helpOffered && requested == _helpRequested) return;
    _helpOffered = offered;
    _helpRequested = requested;
    notifyListeners();
  }

  void clearNativeHelp() {
    if (_helpOffered == null && _helpRequested == null) return;
    _helpOffered = null;
    _helpRequested = null;
    notifyListeners();
  }

  bool get signedIn => access != null;

  final _pageActivity = StreamController<void>.broadcast();

  /// The person used the CRM page: activity, like a tap on a native screen.
  Stream<void> get pageActivity => _pageActivity.stream;

  void setNativeAccess(ShellAccess? value) {
    if (identical(value, _nativeAccess)) return;
    _nativeAccess = value;
    // A fresh access check carries the theme as saved, a choice made here included.
    _themeChoice = null;
    notifyListeners();
  }

  String get route => _route;
  bool get pageReady => _pageReady;
  bool get sessionWarning => _sessionWarning;

  /// 'inbox' or 'leads': a page that is a native screen in the app was opened.
  Stream<String> get openScreenRequests => _openScreen.stream;

  /// The person's theme: chosen in Settings just now, else as their profile has it.
  /// Null until known, when the page's own report stands in.
  String? get themeChoice => _themeChoice ?? _nativeAccess?.theme;
  String? _themeChoice;

  ThemeMode get themeMode => switch (themeChoice) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    'system' => ThemeMode.system,
    _ =>
      !_themeKnown
          ? ThemeMode.system
          : _dark
          ? ThemeMode.dark
          : ThemeMode.light,
  };

  /// Applies [mode] at once, before it is saved; null goes back to the saved one.
  void chooseTheme(String? mode) {
    if (mode == _themeChoice) return;
    _themeChoice = mode;
    notifyListeners();
  }

  /// Settings changed in the app: the page loads the person's access and the
  /// organization's settings again, so it shows the same theme, lists and formats.
  void settingsChanged() {
    unawaited(_runScript?.call('window.__dikhoShell&&window.__dikhoShell.settingsChanged&&window.__dikhoShell.settingsChanged()'));
  }

  void attachPage(Future<void> Function(String script) runScript) {
    _runScript = runScript;
  }

  void markPageLoading() {
    _pageReady = false;
    notifyListeners();
  }

  /// A page that never says it is ready must not hide behind the logo for ever.
  void markPageReady() {
    if (_pageReady) return;
    _pageReady = true;
    notifyListeners();
  }

  void handleBody(String body) {
    final message = parseShellMessage(body);
    if (message != null) handle(message);
  }

  void handle(ShellMessage message) {
    switch (message) {
      case AccessMessage(:final access):
        _pageAccess = access;
      case SignedOutMessage(:final reason):
        if (reason != null) _signOutReason = reason;
        if (_pageAccess == null && !_sessionWarning && reason == null) return;
        _pageAccess = null;
        _sessionWarning = false;
      case RouteMessage(:final path):
        if (path == _route) return;
        _route = path;
      case ReadyMessage():
        _pageReady = true;
      case TokenMessage():
        // The app holds the session now; an older page may still answer.
        return;
      case ThemeMessage(:final dark):
        if (_themeKnown && dark == _dark) return;
        _themeKnown = true;
        _dark = dark;
      case OpenScreenMessage(:final screen):
        _openScreen.add(screen);
        return;
      case ActiveMessage():
        _pageActivity.add(null);
        return;
      case WarningMessage(:final showing):
        if (showing == _sessionWarning) return;
        _sessionWarning = showing;
    }
    notifyListeners();
  }

  /// Why the page last signed out, once: the sign-in screen says so.
  String? takeSignOutReason() {
    final reason = _signOutReason;
    _signOutReason = null;
    return reason;
  }

  /// The page signs out after a stretch of no activity it can see, so taps on
  /// native screens have to count. At most once every 30 seconds.
  void noteActivity(String? section, {bool force = false}) {
    final now = _now();
    final last = _lastActivityReport;
    if (!force && last != null && now.difference(last) < const Duration(seconds: 30)) return;
    _lastActivityReport = now;
    final argument = section == null ? '' : "'$section'";
    unawaited(_runScript?.call('window.__dikhoShell&&window.__dikhoShell.noteActivity($argument)'));
  }

  /// [path] comes from the drawer's fixed table.
  /// Opens a CRM page. With [via], that route goes into the page's history first, so
  /// Back from the page lands there (a native screen's own route hands back to it).
  void openWebPage(String path, {String? via}) {
    if (!_pathShapeOk(path)) return;
    if (via != null && !_pathShapeOk(via)) return;
    final first = via == null || via == route ? '' : "window.history.pushState({},'','$via');";
    unawaited(_runScript?.call("${first}window.history.pushState({},'','$path');window.dispatchEvent(new PopStateEvent('popstate'))"));
  }

  // Lowercase letters, digits, hyphens and slashes only: it goes into a script.
  bool _pathShapeOk(String path) => RegExp(r'^/[a-z0-9/-]{0,80}$').hasMatch(path);

  void askForHelp() {
    unawaited(_runScript?.call('window.__dikhoShell&&window.__dikhoShell.askForHelp()'));
  }

  @override
  void dispose() {
    _openScreen.close();
    _pageActivity.close();
    super.dispose();
  }
}
