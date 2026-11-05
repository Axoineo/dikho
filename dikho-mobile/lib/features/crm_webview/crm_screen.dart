import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../../app/app_config.dart';
import '../../app/theme.dart';
import '../../shared/platform_api.dart';
import '../connectivity/load_failure_view.dart';
import '../downloads/file_events.dart';
import '../updater/update_manager.dart';
import 'navigation_policy.dart';
import 'page_scripts.dart';

/// The CRM's build needs modern JavaScript. Below this the page would render
/// blank, so the person is told to update the WebView instead.
const minimumWebViewMajor = 111;

enum _LoadState { loading, ready, failed }

/// The whole app, as far as the person is concerned: the CRM in a WebView, with
/// branded screens for the moments it cannot show anything.
class CrmScreen extends StatefulWidget {
  const CrmScreen({
    super.key,
    required this.platform,
    required this.info,
    required this.navigatorKey,
  });

  final PlatformApi platform;
  final AppInfo info;
  final GlobalKey<NavigatorState> navigatorKey;

  @override
  State<CrmScreen> createState() => _CrmScreenState();
}

class _CrmScreenState extends State<CrmScreen> with WidgetsBindingObserver {
  static const _firstLoadPatience = Duration(seconds: 30);
  static const _staleAfter = Duration(hours: 8);
  static const _exitWindow = Duration(seconds: 2);
  static const _webViewListing =
      'https://play.google.com/store/apps/details?id=com.google.android.webview';

  late final NavigationPolicy _policy = NavigationPolicy(
    crmOrigin: AppConfig.crmUri,
    apiOrigin: AppConfig.apiUri,
    extraFileOrigins: AppConfig.localTestBuild
        ? {AppConfig.apiUri.origin}
        : const {},
  );

  late final UpdateManager _updates = UpdateManager(
    platform: widget.platform,
    info: widget.info,
    navigatorKey: widget.navigatorKey,
  );

  late final FileEvents _fileEvents = FileEvents(
    platform: widget.platform,
    messengerOf: () => ScaffoldMessenger.maybeOf(context),
  );

  WebViewController? _controller;
  StreamSubscription<Map<Object?, Object?>>? _events;
  Timer? _patience;

  _LoadState _state = _LoadState.loading;
  bool _unsupportedWebView = false;
  bool _slow = false;
  bool _mainFrameFailed = false;
  bool _serverFailed = false;
  bool _updateCheckStarted = false;
  Color _pageTop = DikhoColors.surfaceLight;
  Color _pageBottom = DikhoColors.surfaceLight;
  DateTime? _awaySince;
  DateTime? _lastBackPress;
  String _lastMainUrl = AppConfig.crmOrigin;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _events = widget.platform.events.listen(_onPlatformEvent);
    final webView = widget.info.webViewMajor;
    if (webView != 0 && webView < minimumWebViewMajor) {
      _unsupportedWebView = true;
    } else {
      unawaited(_start());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _events?.cancel();
    _patience?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    // Only so the device tests can drive the page. Never on in a real build.
    if (AppConfig.localTestBuild) {
      await AndroidWebViewController.enableDebugging(true);
    }

    final controller = WebViewController.fromPlatformCreationParams(
      AndroidWebViewControllerCreationParams(),
      onPermissionRequest: (request) => request.deny(),
    );
    final android = controller.platform as AndroidWebViewController;

    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setBackgroundColor(DikhoColors.surfaceLight);
    final userAgent = await controller.getUserAgent();
    await controller.setUserAgent(
      '$userAgent DikhoCRM/${widget.info.versionName}',
    );

    await android.setAllowFileAccess(false);
    await android.setAllowContentAccess(false);
    await android.setGeolocationEnabled(false);
    await android.setMixedContentMode(MixedContentMode.neverAllow);
    await android.setOnShowFileSelector(_pickFiles);
    // The CRM logs errors that can carry business data. Without a handler the
    // WebView copies every console line into the Android system log.
    await controller.setOnConsoleMessage((_) {});

    await controller.setOnJavaScriptAlertDialog(_onAlert);
    await controller.setOnJavaScriptConfirmDialog(_onConfirm);
    await controller.setOnJavaScriptTextInputDialog(_onPrompt);

    await controller.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: _onNavigationRequest,
        onPageStarted: _onPageStarted,
        onPageFinished: _onPageFinished,
        onWebResourceError: _onWebResourceError,
        onHttpError: _onHttpError,
      ),
    );

    // After the delegate: setting one replaces the download listener, and the
    // bridge's listener must be the one that stays.
    final attached = await widget.platform.attachWebView(
      android.webViewIdentifier,
      AppConfig.crmOrigin,
      forceSaveDialog: AppConfig.localTestForceSaveDialog,
    );
    if (!mounted) return;
    if (!attached) {
      setState(() => _unsupportedWebView = true);
      return;
    }

    setState(() => _controller = controller);

    final link = await widget.platform.initialLink();
    final start = link != null && _policy.isAllowedDeepLink(link)
        ? Uri.parse(link)
        : AppConfig.crmUri;
    _load(start);
  }

  void _load(Uri uri) {
    _lastMainUrl = uri.toString();
    _patience?.cancel();
    _patience = Timer(_firstLoadPatience, () {
      if (mounted && _state == _LoadState.loading) {
        setState(() => _slow = true);
      }
    });
    unawaited(_controller?.loadRequest(uri));
  }

  void _retry() {
    setState(() {
      _state = _LoadState.loading;
      _slow = false;
      _mainFrameFailed = false;
    });
    _load(Uri.parse(_lastMainUrl));
  }

  /* ── Navigation ─────────────────────────────────────────────────────── */

  NavigationDecision _onNavigationRequest(NavigationRequest request) {
    switch (_policy.classify(request.url)) {
      case NavigationTarget.inApp:
        return NavigationDecision.navigate;
      case NavigationTarget.external:
        unawaited(_openExternal(request.url));
      case NavigationTarget.file:
        unawaited(widget.platform.fetchFile(url: request.url, view: true));
      case NavigationTarget.blocked:
        break;
    }
    return NavigationDecision.prevent;
  }

  Future<void> _openExternal(String url) async {
    final opened = await widget.platform.openExternal(url);
    if (!opened && mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(
          content: Text('No app on this phone can open that link.'),
        ),
      );
    }
  }

  void _onPageStarted(String url) {
    // The failed flag is left alone here: an HTTP error on the document arrives
    // before this callback, and clearing it would show the server's error page.
    if (_policy.classify(url) == NavigationTarget.inApp) _lastMainUrl = url;
  }

  void _onPageFinished(String url) {
    _patience?.cancel();
    // onPageFinished also fires after a failed load. The error already showed.
    if (_mainFrameFailed || !mounted) return;
    setState(() {
      _state = _LoadState.ready;
      _slow = false;
    });
    _startUpdateCheck();
  }

  /// Runs once the CRM is up, or after a failed load: never before, so it can
  /// never slow startup or fight the page for the network.
  void _startUpdateCheck() {
    if (_updateCheckStarted) return;
    _updateCheckStarted = true;
    unawaited(_updates.checkIfDue());
  }

  void _onWebResourceError(WebResourceError error) {
    if (error.isForMainFrame != true || !mounted) return;
    _showFailure();
  }

  void _onHttpError(HttpResponseError error) {
    final status = error.response?.statusCode ?? 0;
    final uri = error.request?.uri;
    if (status < 500 || uri == null || !mounted) return;
    // Subresources and API calls report here too. Only the document itself
    // failing means the CRM is down.
    if (_isSameDocument(uri, Uri.parse(_lastMainUrl))) {
      _showFailure(server: true);
    }
  }

  /// The WebView adds the trailing slash to a bare origin. Treat them as equal.
  static bool _isSameDocument(Uri a, Uri b) {
    String path(Uri uri) => uri.path.isEmpty ? '/' : uri.path;
    return a.origin == b.origin && path(a) == path(b) && a.query == b.query;
  }

  void _showFailure({bool server = false}) {
    _mainFrameFailed = true;
    _patience?.cancel();
    setState(() {
      _state = _LoadState.failed;
      _serverFailed = server;
      _slow = false;
    });
    _startUpdateCheck();
  }

  void _onPlatformEvent(Map<Object?, Object?> event) {
    switch (event['type']) {
      case 'network':
        // Connectivity came back while the failure screen was up.
        if (_state == _LoadState.failed) _retry();
      case 'chrome':
        final top = event['top'];
        final bottom = event['bottom'];
        if (top is int && bottom is int && mounted) {
          setState(() {
            _pageTop = Color(0xFF000000 | top);
            _pageBottom = Color(0xFF000000 | bottom);
          });
        }
      case 'deepLink':
        final link = event['url'];
        if (link is String && _policy.isAllowedDeepLink(link)) {
          _load(Uri.parse(link));
        }
      case 'fileRequested':
        final url = event['url'];
        if (url is String) _onFileRequested(url, event);
      default:
        _fileEvents.handle(event);
    }
  }

  /// A link the page asked to download, or that the WebView could not render.
  /// The policy decides here too, so no page content picks what gets fetched.
  void _onFileRequested(String url, Map<Object?, Object?> event) {
    final view = event['view'] == true;
    switch (_policy.classify(url)) {
      case NavigationTarget.file:
      case NavigationTarget.inApp:
        unawaited(
          widget.platform.fetchFile(
            url: url,
            view: view,
            name: event['name'] as String?,
            mime: event['mime'] as String?,
            contentDisposition: event['contentDisposition'] as String?,
          ),
        );
      case NavigationTarget.external:
        unawaited(_openExternal(url));
      case NavigationTarget.blocked:
        break;
    }
  }

  /* ── JavaScript dialogs ─────────────────────────────────────────────── */

  // window.confirm guards deletions and campaign sends in the CRM. Without
  // these handlers it would silently answer "no" and those buttons would do
  // nothing at all.

  Future<void> _onAlert(JavaScriptAlertDialogRequest request) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        content: Text(request.message),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Future<bool> _onConfirm(JavaScriptConfirmDialogRequest request) async {
    final answer = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        content: Text(request.message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('OK'),
          ),
        ],
      ),
    );
    return answer ?? false;
  }

  Future<String> _onPrompt(JavaScriptTextInputDialogRequest request) async {
    final field = TextEditingController(text: request.defaultText ?? '');
    final answer = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(request.message),
            TextField(controller: field, autofocus: true),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(field.text),
            child: const Text('OK'),
          ),
        ],
      ),
    );
    field.dispose();
    return answer ?? '';
  }

  Future<List<String>> _pickFiles(FileSelectorParams params) =>
      widget.platform.pickFiles(
        params.acceptTypes,
        params.mode == FileSelectorMode.openMultiple,
      );

  /* ── System back ────────────────────────────────────────────────────── */

  Future<void> _onBack() async {
    final controller = _controller;
    if (controller != null && _state == _LoadState.ready) {
      final Object layer;
      try {
        layer = await controller.runJavaScriptReturningResult(
          closeTopLayerScript,
        );
      } on PlatformException {
        return;
      }
      if (layer.toString().contains('layer')) return;
      if (await controller.canGoBack()) {
        await controller.goBack();
        return;
      }
    }
    final now = DateTime.now();
    final last = _lastBackPress;
    if (last != null && now.difference(last) < _exitWindow) {
      await SystemNavigator.pop();
      return;
    }
    _lastBackPress = now;
    if (mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(
          content: Text('Press back again to exit'),
          duration: _exitWindow,
        ),
      );
    }
  }

  /* ── App lifecycle ──────────────────────────────────────────────────── */

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      // From the first sign of leaving: Android can delay the later states.
      _awaySince ??= DateTime.now();
      return;
    }
    final awaySince = _awaySince;
    _awaySince = null;
    unawaited(_updates.onResumed());
    // The first check waits for the CRM. See _startUpdateCheck.
    if (_updateCheckStarted) unawaited(_updates.checkIfDue());
    if (_state == _LoadState.failed) {
      _retry();
    } else if (awaySince != null) {
      unawaited(_refreshIfStale(awaySince));
    }
  }

  /// A process kept alive for days would otherwise never see a web release.
  /// Fresh starts always load the current build, so this only covers that case,
  /// and never while a form or dialog could lose someone's work.
  Future<void> _refreshIfStale(DateTime awaySince) async {
    final controller = _controller;
    if (controller == null) return;
    if (DateTime.now().difference(awaySince) < _staleAfter) return;
    try {
      final busy = await controller.runJavaScriptReturningResult(
        pageIsBusyScript,
      );
      if (!busy.toString().contains('busy')) await controller.reload();
    } on PlatformException {
      // The page is gone or still loading: nothing to refresh.
    }
  }

  /* ── Layout ─────────────────────────────────────────────────────────── */

  @override
  Widget build(BuildContext context) {
    // The bars match whatever is on screen: the page's own edges once it shows,
    // otherwise the native screen covering it.
    final Color top;
    final Color bottom;
    if (_unsupportedWebView || _state == _LoadState.failed) {
      top = bottom = Theme.of(context).colorScheme.surface;
    } else if (_state == _LoadState.ready) {
      top = _pageTop;
      bottom = _pageBottom;
    } else {
      top = bottom = DikhoColors.surfaceLight;
    }
    final controller = _controller;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: Colors.transparent,
        statusBarIconBrightness: _iconsOn(top),
        statusBarBrightness: ThemeData.estimateBrightnessForColor(top),
        systemNavigationBarIconBrightness: _iconsOn(bottom),
      ),
      child: PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) unawaited(_onBack());
        },
        child: Scaffold(
          backgroundColor: bottom,
          resizeToAvoidBottomInset: true,
          body: Stack(
            children: [
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                height: MediaQuery.paddingOf(context).top,
                child: ColoredBox(color: top),
              ),
              SafeArea(
                child: Stack(
                  children: [
                    if (controller != null)
                      Positioned.fill(
                        child: WebViewWidget.fromPlatformCreationParams(
                          params: AndroidWebViewWidgetCreationParams(
                            controller: controller.platform,
                            displayWithHybridComposition: true,
                          ),
                        ),
                      ),
                    if (_unsupportedWebView)
                      LoadFailureView(
                        title: 'Update Android System WebView',
                        message:
                            'Dikho CRM needs a newer version of Android '
                            'System WebView. Update it from the Play Store, then '
                            'open this app again.',
                        actionLabel: 'Open Play Store',
                        onAction: () =>
                            unawaited(_openExternal(_webViewListing)),
                      )
                    else if (_state == _LoadState.failed)
                      LoadFailureView(
                        title: _serverFailed
                            ? 'Dikho CRM is not responding'
                            : "Can't reach Dikho CRM",
                        message: _serverFailed
                            ? 'This is a problem on our side, not with your '
                                  'phone. Please try again in a minute.'
                            : 'Check your internet connection. This page will '
                                  'try again by itself when you are back online.',
                        onAction: _retry,
                      )
                    else if (_state == _LoadState.loading)
                      _Splash(slow: _slow, onRetry: _retry),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Brightness _iconsOn(Color ground) =>
    ThemeData.estimateBrightnessForColor(ground) == Brightness.dark
    ? Brightness.light
    : Brightness.dark;

/// Same white ground and mark as the CRM's own boot splash, so the hand-over
/// from native to web shows no flash and no blank screen.
class _Splash extends StatelessWidget {
  const _Splash({required this.slow, required this.onRetry});

  final bool slow;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: DikhoColors.surfaceLight,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/brand/logo.png', width: 148),
            if (slow) ...[
              const SizedBox(height: 28),
              const Text(
                'This is taking longer than usual.',
                style: TextStyle(color: DikhoColors.mutedLight),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: onRetry,
                style: TextButton.styleFrom(foregroundColor: DikhoColors.brand),
                child: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
