/// Compile-time configuration. All of it is public: nothing secret may ever be
/// passed as a --dart-define, because it ends up readable in the APK.
library;

class AppConfig {
  const AppConfig._();

  static const appId = 'in.dikho.crm';

  static const crmOrigin = String.fromEnvironment(
    'CRM_ORIGIN',
    defaultValue: 'https://manage.dikho.in',
  );

  static const apiOrigin = String.fromEnvironment(
    'API_ORIGIN',
    defaultValue: 'https://dikho-api.fineeurox.workers.dev',
  );

  /// The workers.dev host needs no DNS change. dikho.in's DNS is not on
  /// Cloudflare, so a Worker cannot serve updates.dikho.in today. See
  /// cloudflare-updater/README.md before changing this for a release.
  static const updateBaseUrl = String.fromEnvironment(
    'UPDATE_BASE_URL',
    defaultValue: 'https://dikho-updates.fineeurox.workers.dev',
  );

  static const updateChannel = String.fromEnvironment(
    'UPDATE_CHANNEL',
    defaultValue: 'stable',
  );

  /// Extra hosts allowed to serve the APK, comma separated. Empty means the
  /// update host only. Needed only if releases move off Static Assets.
  static const extraApkHosts = String.fromEnvironment('EXTRA_APK_HOSTS');

  /// Set only by tool/local-test builds. Lets the origins above be plain http
  /// on localhost, and never ships: tool/build-release.sh refuses it.
  static const localTestBuild = bool.fromEnvironment('LOCAL_TEST_BUILD');

  /// Local test builds only: exercises the Android 7 to 9 save path on a newer
  /// emulator, because those versions' WebViews cannot run the CRM unaided.
  static const localTestForceSaveDialog =
      localTestBuild && bool.fromEnvironment('FORCE_SAVE_DIALOG');

  static Uri get crmUri => Uri.parse(crmOrigin);
  static Uri get apiUri => Uri.parse(apiOrigin);
  static Uri get updateUri => Uri.parse(updateBaseUrl);

  /// The problems with a set of values, empty when they are safe to run with.
  static List<String> problems({
    String crm = crmOrigin,
    String api = apiOrigin,
    String update = updateBaseUrl,
    bool localTest = localTestBuild,
  }) {
    final found = <String>[];
    for (final (name, value) in [
      ('CRM', crm),
      ('API', api),
      ('update', update),
    ]) {
      final uri = Uri.tryParse(value);
      if (uri == null || !uri.hasAuthority || uri.userInfo.isNotEmpty) {
        found.add('$name origin is not a valid URL');
      } else if (uri.scheme != 'https' &&
          !(localTest && uri.scheme == 'http' && uri.host == 'localhost')) {
        found.add('$name origin must use https');
      }
    }
    return found;
  }

  /// Hop-by-hop rule for the APK download: https only, or the local test
  /// server in a local test build.
  static bool isAllowedDownloadHop(Uri uri, {bool localTest = localTestBuild}) {
    if (uri.userInfo.isNotEmpty) return false;
    if (uri.scheme == 'https') return true;
    return localTest && uri.scheme == 'http' && uri.host == 'localhost';
  }

  /// Where the server may tell the app to fetch an APK from.
  static bool isAllowedApkUrl(
    Uri uri, {
    String update = updateBaseUrl,
    String extraHosts = extraApkHosts,
    bool localTest = localTestBuild,
  }) {
    if (!isAllowedDownloadHop(uri, localTest: localTest)) return false;
    if (!uri.path.endsWith('.apk') || uri.hasQuery || uri.hasFragment) {
      return false;
    }
    final updateUri = Uri.parse(update);
    if (uri.host == updateUri.host && uri.port == updateUri.port) return true;
    return extraHosts
        .split(',')
        .map((host) => host.trim())
        .where((host) => host.isNotEmpty)
        .contains(uri.host);
  }
}
