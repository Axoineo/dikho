import 'dart:async';

import '../../shared/crm_api.dart';
import '../../shared/paged_rows.dart';
import 'leads_models.dart';

/// The lead list, newest first, with the WhatsApp confirmation state for each number
/// from the API.
class LeadsController extends PagedRows<Lead> {
  LeadsController({required super.rest, required this.api, super.pageSize, super.searchDelay})
    : super(table: 'cg_leads', order: 'created_at.desc,id.desc');

  final CrmApi api;

  Map<String, LeadStatus> statuses = const {};

  List<Lead> get leads => rows;

  @override
  Lead parse(Map<String, dynamic> row) => Lead(row);

  @override
  String idOf(Lead row) => row.id;

  @override
  String? searchFilter(String query) => leadSearchFilter(query);

  int countOf(String status) => statuses.values.where((s) => s.status == status).length;

  LeadStatus? statusFor(Lead lead) => statuses[lead.statusKey];

  Future<void> start() => Future.wait([reload(), loadStatuses()]);

  /// Not needed for the list itself: if it fails, every lead reads "Not sent".
  Future<void> loadStatuses() async {
    try {
      final data = await api.get('/cg-leads/whatsapp-status');
      statuses = latestStatuses(data['statuses'] as List? ?? const []);
      notify();
    } on ApiException {
      // The next refresh tries again.
    }
  }

  Future<void> refresh() => Future.wait([reload(), loadStatuses()]);
}
