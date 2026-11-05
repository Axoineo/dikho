/// Decides where a URL may go. Pure logic, so every rule has a unit test and
/// nothing here depends on the WebView.
library;

enum NavigationTarget {
  /// Stays in the WebView. Only the CRM's own origin qualifies.
  inApp,

  /// Handed to the system browser or the app that owns the scheme.
  external,

  /// A short-lived file link (signed or ticketed): fetched natively and opened
  /// in a viewer, so it never lands in a browser's history.
  file,

  /// Refused outright.
  blocked,
}

class NavigationPolicy {
  NavigationPolicy({
    required this.crmOrigin,
    required this.apiOrigin,
    this.extraFileOrigins = const {},
  });

  final Uri crmOrigin;
  final Uri apiOrigin;

  /// Local test builds only: the fake backend has no supabase.co host.
  final Set<String> extraFileOrigins;

  /// Schemes another app may handle. `intent:` and `market:` are deliberately
  /// absent: a page must never be able to pick the component that opens.
  static const _externalSchemes = {
    'http',
    'https',
    'mailto',
    'tel',
    'sms',
    'whatsapp',
    'geo',
  };

  /// The only CRM paths another app may open inside the WebView.
  static const _deepLinkPaths = {'/email/connect'};

  NavigationTarget classify(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme.isEmpty) return NavigationTarget.blocked;
    if (uri.userInfo.isNotEmpty) return NavigationTarget.blocked;
    if (_sameOrigin(uri, crmOrigin)) return NavigationTarget.inApp;
    if (_isFileLink(uri)) return NavigationTarget.file;
    if (_externalSchemes.contains(uri.scheme.toLowerCase())) {
      return NavigationTarget.external;
    }
    return NavigationTarget.blocked;
  }

  /// True when an incoming Android link may be loaded in the WebView.
  bool isAllowedDeepLink(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || uri.userInfo.isNotEmpty) return false;
    return _sameOrigin(uri, crmOrigin) && _deepLinkPaths.contains(uri.path);
  }

  bool _isFileLink(Uri uri) {
    if (uri.scheme != 'https' && uri.scheme != 'http') return false;
    if (extraFileOrigins.contains(uri.origin)) return true;
    if (uri.scheme != 'https') return false;
    if (uri.host.endsWith('.supabase.co')) {
      return uri.path.startsWith('/storage/v1/object/');
    }
    return _sameOrigin(uri, apiOrigin) &&
        uri.path.startsWith('/api/whatsapp/media/');
  }

  static bool _sameOrigin(Uri a, Uri b) {
    if (!a.hasScheme || !b.hasScheme) return false;
    if (a.scheme != 'https' && a.scheme != 'http') return false;
    return a.scheme == b.scheme && a.host == b.host && a.port == b.port;
  }
}
