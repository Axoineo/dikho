import 'dart:io';

import '../../shared/crm_api.dart';
import '../../shared/paged_rows.dart';
import '../clients/clients_models.dart' show registrationOptions;
import 'vendors_models.dart';

/// A document picked for a vendor, already copied into the app's own storage.
class PickedDocument {
  const PickedDocument({required this.file, required this.name, required this.mime});

  final File file;
  final String name;
  final String mime;
}

/// The vendor list, newest first, with the web page's status and media filters, and
/// saving one. RLS and Storage policies decide who may add or change a vendor
/// (vendors.create, vendors.edit); the screens only choose what to offer.
class VendorsController extends PagedRows<Vendor> {
  VendorsController({required super.rest, super.pageSize, super.searchDelay, DateTime Function()? now})
    : _now = now ?? DateTime.now,
      super(table: 'vendors', order: 'id.desc', select: vendorSelect);

  final DateTime Function() _now;

  static const bucket = 'Dikho';

  bool? statusFilter;
  int? mediaFilter;
  int? subMediaFilter;

  List<MediaOption> media = const [];
  List<MediaOption> subMedia = const [];

  /// Countries, states and cities already in use, for the form's suggestions.
  List<({String country, String state, String city})> places = const [];
  bool catalogLoaded = false;

  Object? _settings;
  bool _settingsLoaded = false;

  @override
  Vendor parse(Map<String, dynamic> row) => Vendor(row);

  @override
  String idOf(Vendor row) => row.id;

  @override
  String? searchFilter(String query) => vendorSearchFilter(query);

  @override
  Map<String, String> get filters => {
    if (statusFilter != null) 'status': 'eq.${statusFilter! ? 1 : 0}',
    if (mediaFilter != null) 'media_id': 'eq.$mediaFilter',
    if (subMediaFilter != null) 'sub_media_id': 'eq.$subMediaFilter',
  };

  bool get filtered => statusFilter != null || mediaFilter != null || subMediaFilter != null;

  Future<void> start() async {
    await Future.wait([reload(), loadCatalog()]);
  }

  /// Sets the filters together; a sub media that does not belong to the media is dropped.
  void setFilters({bool? status, int? mediaId, int? subMediaId}) {
    statusFilter = status;
    mediaFilter = mediaId;
    subMediaFilter = mediaId == null || subMedia.any((s) => s.id == subMediaId && s.mediaId == mediaId) ? subMediaId : null;
    filtersChanged();
  }

  String mediaName(int? id) => media.firstWhere((m) => m.id == id, orElse: () => const MediaOption(0, '')).name;
  String subMediaName(int? id) => subMedia.firstWhere((m) => m.id == id, orElse: () => const MediaOption(0, '')).name;

  Future<void> loadCatalog() async {
    try {
      final results = await Future.wait([
        rest.select('media', query: {'select': 'id,name', 'order': 'name.asc'}, from: 0, to: 999),
        rest.select('sub_media', query: {'select': 'id,name,media_id', 'order': 'name.asc'}, from: 0, to: 1999),
      ]);
      media = [for (final row in results[0].rows) ?MediaOption.from(row)];
      subMedia = [for (final row in results[1].rows) ?MediaOption.from(row)];
      final seen = <String>{};
      final found = <({String country, String state, String city})>[];
      // A page at a time, as fetchAllPaged does, up to a sane number of rows.
      for (var from = 0; from < 5000; from += 1000) {
        final page = await rest.select('vendor_addresses', query: {'select': 'state,city,country', 'order': 'id.asc'}, from: from, to: from + 999);
        for (final row in page.rows) {
          final place = (country: '${row['country'] ?? ''}'.trim(), state: '${row['state'] ?? ''}'.trim(), city: '${row['city'] ?? ''}'.trim());
          if (seen.add('${place.country}|${place.state}|${place.city}')) found.add(place);
        }
        if (page.rows.length < 1000) break;
      }
      places = found;
      catalogLoaded = true;
    } on ApiException {
      // The list works without them; the form says if media cannot be chosen.
    }
    notify();
  }

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

  /// A short-lived link to the vendor's document, made only when asked for.
  Future<Uri> documentLink(Vendor vendor) => rest.signedUrl(bucket, vendor.documentPath);

  /// Adds a vendor or changes [existing], as createVendor and updateVendor in
  /// VendorForm.jsx do, step by step and undoing what a failed step left behind.
  Future<Vendor> save(Vendor? existing, VendorDraft draft, {PickedDocument? document}) async {
    final vendor = existing == null ? await _create(draft, document) : await _update(existing, draft, document);
    upsert(vendor);
    // A new city or media can add a suggestion.
    loadCatalogQuietly();
    return vendor;
  }

  void loadCatalogQuietly() => loadCatalog().ignore();

  /// Settings changed a list or the media: the form loads them again when it opens,
  /// and the list's media names follow at once.
  void settingsChanged() {
    _settingsLoaded = false;
    loadCatalogQuietly();
  }

  Future<Vendor> _create(VendorDraft draft, PickedDocument? document) async {
    final saved = await rest.insert('vendors', {...draft.vendorPayload(), 'vendor_document_file_name': document?.name});
    final id = saved['id'];
    if (id == null) throw const ApiException('The vendor was created but no ID came back.');
    final Map<String, dynamic> address;
    try {
      address = await rest.insert('vendor_addresses', draft.addressPayload(id));
    } on ApiException {
      await _undo(() => rest.deleteWhere('vendors', column: 'id', value: id));
      rethrow;
    }
    var row = {
      ...saved,
      'vendor_addresses': [address],
    };
    if (document != null) {
      final path = vendorDocumentPath(id, document.name, _now());
      try {
        await rest.uploadObject(bucket, path, document.file, contentType: document.mime);
      } on ApiException catch (failure) {
        await _undo(() => rest.deleteWhere('vendor_addresses', column: 'vendor_id', value: id));
        await _undo(() => rest.deleteWhere('vendors', column: 'id', value: id));
        throw ApiException('The document could not be uploaded, so the vendor was not added. ${failure.message}');
      }
      try {
        final updated = await rest.update('vendors', id: id, patch: {'vendor_document_file_path': path, 'vendor_document_file_name': document.name});
        row = {...row, ...updated};
      } on ApiException {
        await _undo(() => rest.removeObjects(bucket, [path]));
        await _undo(() => rest.deleteWhere('vendor_addresses', column: 'vendor_id', value: id));
        await _undo(() => rest.deleteWhere('vendors', column: 'id', value: id));
        rethrow;
      }
    }
    return Vendor(row);
  }

  Future<Vendor> _update(Vendor existing, VendorDraft draft, PickedDocument? document) async {
    final saved = await rest.update('vendors', id: existing.id, patch: draft.vendorPayload());
    // The vendor row is committed from here on, so a later failure says exactly what
    // did and did not save rather than pretending nothing did.
    final Map<String, dynamic> address;
    try {
      final old = existing.address?.id;
      address = old != null
          ? await rest.update('vendor_addresses', id: old, patch: draft.addressPayload(existing.id))
          : await rest.insert('vendor_addresses', draft.addressPayload(existing.id));
    } on ApiException catch (failure) {
      throw ApiException('The vendor details were saved, but the address was not. ${failure.message}');
    }
    var row = {
      ...existing.raw,
      ...saved,
      'vendor_addresses': [address],
    };
    if (document != null) {
      final path = vendorDocumentPath(existing.id, document.name, _now());
      try {
        await rest.uploadObject(bucket, path, document.file, contentType: document.mime);
      } on ApiException catch (failure) {
        throw ApiException('The vendor details were saved, but the document was not uploaded. ${failure.message}');
      }
      try {
        final updated = await rest.update(
          'vendors',
          id: existing.id,
          patch: {'vendor_document_file_path': path, 'vendor_document_file_name': document.name},
        );
        row = {...row, ...updated};
      } on ApiException catch (failure) {
        await _undo(() => rest.removeObjects(bucket, [path]));
        throw ApiException('The vendor details were saved, but the new document could not be attached. ${failure.message}');
      }
    }
    return Vendor(row);
  }

  /// A clean-up step after a failure: its own failure must not hide the first one.
  Future<void> _undo(Future<void> Function() step) async {
    try {
      await step();
    } on ApiException {
      // The original failure is what the person needs to see.
    }
  }
}
