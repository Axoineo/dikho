/// The update API's answer, validated field by field. The server is trusted
/// for nothing that matters: a response that fails here is treated as "no
/// update", and the APK itself is checked again after download.
library;

class UpdateInfo {
  const UpdateInfo({
    required this.version,
    required this.versionCode,
    required this.mandatory,
    required this.releaseNotes,
    required this.apkUrl,
    required this.sha256,
    required this.sizeBytes,
    required this.publishedAt,
  });

  final String version;
  final int versionCode;
  final bool mandatory;
  final String releaseNotes;
  final Uri apkUrl;
  final String sha256;
  final int sizeBytes;
  final DateTime publishedAt;

  static const maxApkBytes = 200 * 1024 * 1024;
  static const _maxNotesLength = 2000;
  static final _version = RegExp(r'^\d{1,4}\.\d{1,4}\.\d{1,4}$');
  static final _sha256 = RegExp(r'^[0-9a-f]{64}$');

  /// Returns null when the server reports no update. Throws [FormatException]
  /// for anything malformed, including a "newer" version that is not newer.
  static UpdateInfo? parse(
    Object? json, {
    required int installedVersionCode,
    required bool Function(Uri) isAllowedApkUrl,
  }) {
    if (json is! Map) throw const FormatException('response is not an object');
    final available = json['updateAvailable'];
    if (available == false) return null;
    if (available != true) {
      throw const FormatException('updateAvailable is missing');
    }

    final version = json['version'];
    if (version is! String || !_version.hasMatch(version)) {
      throw const FormatException('version is invalid');
    }
    final versionCode = json['versionCode'];
    if (versionCode is! int || versionCode <= installedVersionCode) {
      throw const FormatException('versionCode is not newer');
    }
    final mandatory = json['mandatory'];
    if (mandatory is! bool) throw const FormatException('mandatory is invalid');
    final notes = json['releaseNotes'];
    if (notes is! String || notes.length > _maxNotesLength) {
      throw const FormatException('releaseNotes is invalid');
    }
    final rawUrl = json['apkUrl'];
    final apkUrl = rawUrl is String ? Uri.tryParse(rawUrl) : null;
    if (apkUrl == null || !isAllowedApkUrl(apkUrl)) {
      throw const FormatException('apkUrl is not allowed');
    }
    final sha256 = json['sha256'];
    if (sha256 is! String || !_sha256.hasMatch(sha256)) {
      throw const FormatException('sha256 is invalid');
    }
    final size = json['sizeBytes'];
    if (size is! int || size < 1 || size > maxApkBytes) {
      throw const FormatException('sizeBytes is invalid');
    }
    final rawDate = json['publishedAt'];
    final publishedAt = rawDate is String ? DateTime.tryParse(rawDate) : null;
    if (publishedAt == null) {
      throw const FormatException('publishedAt is invalid');
    }

    return UpdateInfo(
      version: version,
      versionCode: versionCode,
      mandatory: mandatory,
      releaseNotes: notes,
      apkUrl: apkUrl,
      sha256: sha256,
      sizeBytes: size,
      publishedAt: publishedAt,
    );
  }
}
