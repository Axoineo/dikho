import 'dart:async';
import 'dart:io' show Directory, File, HttpClient;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../../app/app_config.dart';
import '../../app/theme.dart';
import '../../shared/platform_api.dart';
import '../../shared/crm_api.dart';
import '../../shared/supabase_rest.dart';
import '../connectivity/load_failure_view.dart';
import '../device_contacts/device_contacts_screen.dart';
import '../downloads/file_events.dart';
import '../inbox/chat_list_screen.dart';
import '../inbox/inbox_api.dart';
import '../inbox/inbox_controller.dart';
import '../inbox/inbox_realtime.dart';
import '../inbox/inbox_scope.dart';
import '../inbox/media_repository.dart';
import '../clients/clients_controller.dart';
import '../clients/clients_models.dart';
import '../clients/clients_screen.dart';
import '../leads/leads_controller.dart';
import '../purchase_orders/purchase_orders_controller.dart';
import '../purchase_orders/purchase_orders_models.dart';
import '../purchase_orders/purchase_orders_screen.dart';
import '../auth/auth_controller.dart';
import '../auth/page_access.dart' as pages;
import '../auth/session_guard.dart';
import '../auth/sign_in_screen.dart';
import '../sales_orders/sales_orders_controller.dart';
import '../users/users_controller.dart';
import '../users/users_models.dart' show sectionLabels;
import '../users/users_screen.dart';
import '../settings/settings_controller.dart';
import '../settings/settings_screen.dart';
import '../sales_orders/sales_orders_models.dart';
import '../sales_orders/sales_orders_screen.dart';
import '../vendors/vendors_controller.dart';
import '../vendors/vendors_models.dart';
import '../vendors/vendors_screen.dart';
import '../whatsapp/campaigns_screen.dart';
import '../whatsapp/contacts_controller.dart';
import '../whatsapp/contacts_screen.dart';
import '../whatsapp/dashboard_screen.dart';
import '../whatsapp/templates_screen.dart';
import '../leads/leads_screen.dart';
import '../shell/app_drawer.dart';
import '../live_assist/assist_api.dart';
import '../live_assist/assist_link.dart';
import '../live_assist/assist_widgets.dart';
import '../live_assist/helper_viewer_screen.dart';
import '../live_assist/live_assist_controller.dart';
import '../live_assist/screen_frames.dart';
import '../email/email_api.dart';
import '../email/email_campaigns_screen.dart';
import '../email/email_consent_screen.dart';
import '../email/email_settings_screen.dart';
import '../email/email_templates_screen.dart';
import '../email/email_composer_screen.dart';
import '../email/email_controller.dart';
import '../email/email_conversation_screen.dart';
import '../email/email_analytics_screen.dart';
import '../email/email_inbox_screen.dart';
import '../email/email_overview_screen.dart';
import '../email/email_models.dart';
import '../shell/nav_items.dart';
import '../shell/session_vault.dart';
import '../shell/shell_controller.dart';
import '../shell/shell_messages.dart';
import '../splash/logo_animation.dart';
import '../updater/update_dialog.dart';
import '../updater/update_manager.dart';
import 'navigation_policy.dart';
import 'page_scripts.dart';

/// The CRM's build needs modern JavaScript. Below this the page would render
/// blank, so the person is told to update the WebView instead.
const minimumWebViewMajor = 111;

enum _LoadState { loading, ready, failed }

/// The whole app: native sign-in, the native drawer, the native screens, and the CRM
/// in a WebView for every module not yet native. The app owns the session
/// ([AuthController]); the page is loaded only once someone is signed in, and reads
/// that session through the vault.
class CrmScreen extends StatefulWidget {
  const CrmScreen({
    super.key,
    required this.platform,
    required this.info,
    required this.navigatorKey,
    required this.shell,
    required this.auth,
    required this.assistHost,
    required this.captureKey,
  });

  final PlatformApi platform;
  final AppInfo info;
  final GlobalKey<NavigatorState> navigatorKey;
  final ShellController shell;
  final AuthController auth;

  /// Where this screen puts the person's Live Assist, for the app's top layer.
  final ValueNotifier<LiveAssistController?> assistHost;

  /// The boundary around every route and dialog: Live Assist shares pictures of it.
  final GlobalKey captureKey;

  @override
  State<CrmScreen> createState() => _CrmScreenState();
}

class _CrmScreenState extends State<CrmScreen> with WidgetsBindingObserver {
  static const _firstLoadPatience = Duration(seconds: 30);
  static const _staleAfter = Duration(hours: 8);
  static const _exitWindow = Duration(seconds: 2);
  static const _readyPatience = Duration(seconds: 4);

  /// What the WebView holds while nobody is signed in: nothing of the CRM's.
  static const _blankPage = '<!doctype html><meta charset="utf-8"><title>Dikho CRM</title>';
  static const _webViewListing = 'https://play.google.com/store/apps/details?id=com.google.android.webview';

  late final NavigationPolicy _policy = NavigationPolicy(
    crmOrigin: AppConfig.crmUri,
    apiOrigin: AppConfig.apiUri,
    extraFileOrigins: AppConfig.localTestBuild ? {AppConfig.apiUri.origin} : const {},
  );

  late final UpdateManager _updates = UpdateManager(platform: widget.platform, info: widget.info, navigatorKey: widget.navigatorKey);

  late final FileEvents _fileEvents = FileEvents(platform: widget.platform, messengerOf: () => ScaffoldMessenger.maybeOf(context));

  late final SessionVault _vault = SessionVault(platform: widget.platform, auth: widget.auth);
  final _signIn = GlobalKey<SignInScreenState>();

  /// Where the page is to start once someone signs in (a link the app was opened with).
  Uri? _pendingStart;

  /// Google's return (/email/connect) waiting for a signed-in session to finish it.
  Uri? _pendingGoogleReturn;

  /// How the last Google connection ended, shown on Email settings.
  String? _connectOutcome;

  /// The page was loaded for the session now held.
  bool _pageForSession = false;

  ShellController get _shell => widget.shell;

  final _scaffold = GlobalKey<ScaffoldState>();
  // A new pair for each native screen: reusing a key would keep the old screen's
  // navigator, so the drawer could never move from the inbox to Phone contacts.
  GlobalKey<NavigatorState> _nativeNavigator = GlobalKey<NavigatorState>();
  late _NativeDepthObserver _depthObserver = _NativeDepthObserver(_onNativeDepth);

  NativeScreen? _native;
  int _nativeDepth = 0;
  bool _edgeSwipeOn = false;

  // Built when someone signs in, gone when they sign out.
  CrmApi? _api;
  InboxApi? _inboxApi;
  InboxController? _inbox;
  InboxRealtime? _realtime;
  MediaRepository? _media;
  AudioState? _audio;
  SupabaseRest? _rest;
  LeadsController? _leads;
  ContactsController? _contacts;
  VendorsController? _vendors;
  SalesOrdersController? _salesOrders;
  PurchaseOrdersController? _purchaseOrders;
  UsersController? _users;
  SettingsController? _settings;
  EmailApi? _emailApi;
  EmailInboxController? _email;
  SessionGuard? _guard;
  LiveAssistController? _assist;
  StreamSubscription<String>? _assistNotices;
  bool _incomingOpen = false;
  bool _viewerOpen = false;
  StreamSubscription<void>? _pageActivity;
  bool _warningOpen = false;

  /// "New order" on a client, for the Sales orders screen about to open.
  ClientChoice? _newOrderFor;

  /// "New PO" on a vendor, for the Purchase orders screen about to open.
  VendorChoice? _newPoFor;
  ClientsController? _clients;
  StreamSubscription<String>? _openScreen;

  WebViewController? _controller;
  StreamSubscription<Map<Object?, Object?>>? _events;
  Timer? _patience;
  Timer? _readyFallback;

  _LoadState _state = _LoadState.loading;
  bool _unsupportedWebView = false;
  bool _slow = false;
  bool _mainFrameFailed = false;
  bool _serverFailed = false;
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
    _shell.addListener(_onShellChanged);
    widget.auth.addListener(_onAuthChanged);
    // Signed in before this screen was built (the stored session loaded first).
    if (widget.auth.signedIn) _startNativeSession();
    _openScreen = _shell.openScreenRequests.listen(
      (screen) => _openNative(switch (screen) {
        'leads' => NativeScreen.leads,
        'clients' => NativeScreen.clients,
        'templates' => NativeScreen.templates,
        'dashboard' => NativeScreen.dashboard,
        'whatsapp-contacts' => NativeScreen.waContacts,
        'vendors' => NativeScreen.vendors,
        'sales-orders' => NativeScreen.salesOrders,
        'purchase-orders' => NativeScreen.purchaseOrders,
        'users' => NativeScreen.users,
        'settings' => NativeScreen.settings,
        'email-inbox' => NativeScreen.emailInbox,
        'email' => NativeScreen.emailOverview,
        'email-analytics' => NativeScreen.emailAnalytics,
        'email-campaigns' => NativeScreen.emailCampaigns,
        'email-templates' => NativeScreen.emailTemplates,
        'email-consent' => NativeScreen.emailConsent,
        'email-settings' => NativeScreen.emailSettings,
        'whatsapp-campaigns' => NativeScreen.waCampaigns,
        _ => NativeScreen.inbox,
      }),
    );
    _updates.addListener(_onUpdatesChanged);
    unawaited(_updates.start());
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
    _openScreen?.cancel();
    _patience?.cancel();
    _readyFallback?.cancel();
    _shell.removeListener(_onShellChanged);
    widget.auth.removeListener(_onAuthChanged);
    _updates.removeListener(_onUpdatesChanged);
    _updates.dispose();
    _endNativeSession();
    super.dispose();
  }

  void _onUpdatesChanged() {
    if (!mounted) return;
    setState(() {});
    _syncEdgeSwipe();
  }

  /* ── The native side of a session ───────────────────────────────────── */

  void _onShellChanged() {
    if (_shell.pageReady) {
      _updates.allowPrompts();
    }
    if (_native == null) _assist?.screenChanged('page:${_shell.route}');
    // Why the page signed out, when it says: an administrator ended the session, it
    // timed out, or this person has no access (then the app signs out too).
    final reason = _shell.takeSignOutReason();
    if (reason != null) {
      if (widget.auth.signedIn) {
        unawaited(widget.auth.signOut(reason: reason, revoke: const {'suspended', 'archived', 'not_staff'}.contains(reason)));
      } else {
        widget.auth.explain(reason);
      }
    }
    if (mounted) {
      setState(() {});
      _syncEdgeSwipe();
    }
  }

  /// Everything the native screens need for this person, made when they sign in. The
  /// session guard then settles what they may open.
  void _startNativeSession() {
    final api = CrmApi(
      origin: AppConfig.apiUri,
      token: widget.auth.accessToken,
      // Named in User Management's list of sessions, rather than "Dart".
      httpClient: HttpClient()..userAgent = 'DikhoCRM/${widget.info.versionName} (Android)',
    );
    final inboxApi = InboxApi(api);
    _api = api;
    _inboxApi = inboxApi;
    _inbox = InboxController(api: inboxApi);
    _contacts = ContactsController(api);
    _users = UsersController(api: api);
    _media = MediaRepository(origin: AppConfig.apiUri, fetchTicket: inboxApi.mediaTicket, cacheDir: widget.info.cacheDir);
    _audio = AudioState(widget.platform);
    final base = SupabaseRest.parseBase(AppConfig.supabaseUrl);
    if (base != null) {
      final rest = SupabaseRest(base: base, apiKey: AppConfig.supabasePublishableKey, token: widget.auth.accessToken);
      _rest = rest;
      _leads = LeadsController(rest: rest, api: api);
      _clients = ClientsController(rest: rest);
      _vendors = VendorsController(rest: rest);
      _salesOrders = SalesOrdersController(rest: rest);
      _purchaseOrders = PurchaseOrdersController(rest: rest);
      _settings = SettingsController(rest: rest, api: api, onChanged: _settingsChanged);
      if (AppConfig.emailHub) {
        _emailApi = EmailApi(api);
        _email = EmailInboxController(api: _emailApi!);
      }
      final guard = SessionGuard(
        auth: widget.auth,
        rest: rest,
        api: api,
        staffChannel: ({required name, required onEvent}) => InboxRealtime(
          supabaseUrl: AppConfig.supabaseUrl,
          apiKey: AppConfig.supabasePublishableKey,
          token: () => widget.auth.accessToken(),
          channel: name,
          onEvent: onEvent,
          onJoined: () {},
        ),
      )..addListener(_onGuardChanged);
      _guard = guard;
      _pageActivity = _shell.pageActivity.listen((_) => guard.noteActivity(pages.sectionFor(_shell.route)));
      unawaited(guard.start());
    }
  }

  /// What the person may open, and the inactivity warning.
  void _onGuardChanged() {
    final guard = _guard;
    if (guard == null) return;
    _shell.setNativeAccess(guard.access);
    final access = guard.access;
    if (access != null && _assist == null && _api != null) _startAssist(access, guard);
    if (guard.warning && !_warningOpen) unawaited(_showInactivityWarning(guard));
    if (mounted) setState(() {});
  }

  /// "Still there?", counting down, before signing out for inactivity.
  Future<void> _showInactivityWarning(SessionGuard guard) async {
    _warningOpen = true;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => ListenableBuilder(
        listenable: guard,
        builder: (dialogContext, _) {
          if (!guard.warning) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (Navigator.of(dialogContext).canPop()) Navigator.of(dialogContext).pop();
            });
          }
          final seconds = guard.left.inSeconds;
          final time = '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
          return AlertDialog(
            title: const Text('Still there?'),
            content: Text('For your security, Dikho signs you out after 45 minutes without activity. Signing out in $time.'),
            actions: [
              TextButton(onPressed: () => unawaited(widget.auth.signOut()), child: const Text('Sign out')),
              FilledButton(onPressed: () => guard.noteActivity(), child: const Text('Stay signed in')),
            ],
          );
        },
      ),
    );
    _warningOpen = false;
  }

  /// Signed in: the page loads for this session. Signed out: everything held for the
  /// last person goes, and the page with it.
  void _onAuthChanged() {
    final signedIn = widget.auth.signedIn;
    if (signedIn) {
      if (_api == null) _startNativeSession();
      final googleReturn = _pendingGoogleReturn;
      if (googleReturn != null) {
        _pendingGoogleReturn = null;
        unawaited(_finishGoogleConnect(googleReturn));
      }
      if (!_pageForSession && _controller != null) {
        _pageForSession = true;
        final start = _pendingStart ?? AppConfig.crmUri;
        _pendingStart = null;
        _load(start);
      }
    } else if (_api != null || _pageForSession) {
      _endNativeSession();
      _shell.setNativeAccess(null);
      _native = null;
      _nativeDepth = 0;
      _shell.handle(const SignedOutMessage());
      if (_pageForSession) {
        _pageForSession = false;
        _shell.markPageLoading();
        unawaited(_controller?.loadHtmlString(_blankPage));
      }
    }
    if (mounted) {
      setState(() {});
      _syncEdgeSwipe();
    }
  }

  /// Everything fetched for this person goes with them.
  void _endNativeSession() {
    _endAssist();
    _guard?.removeListener(_onGuardChanged);
    _guard?.dispose();
    _guard = null;
    unawaited(_pageActivity?.cancel());
    _pageActivity = null;
    _realtime?.stop();
    _realtime = null;
    _inbox?.dispose();
    _inbox = null;
    unawaited(_media?.wipe());
    _media = null;
    _audio?.dispose();
    _audio = null;
    _leads?.dispose();
    _leads = null;
    _contacts?.dispose();
    _contacts = null;
    _vendors?.dispose();
    _vendors = null;
    _salesOrders?.dispose();
    _salesOrders = null;
    _purchaseOrders?.dispose();
    _purchaseOrders = null;
    _users?.dispose();
    _users = null;
    _settings?.dispose();
    _settings = null;
    _email?.dispose();
    _email = null;
    _emailApi = null;
    _clients?.dispose();
    _clients = null;
    _rest?.close();
    _rest = null;
    _api?.close();
    _api = null;
    _inboxApi = null;
    unawaited(widget.platform.audioStop().catchError((Object _) {}));
  }

  /// Only while the inbox is on screen and the app is in the foreground.
  void _syncRealtime() {
    final access = _shell.access;
    final inbox = _inbox;
    final wanted =
        _native == NativeScreen.inbox && _inForeground && access != null && inbox != null && SupabaseRest.parseBase(AppConfig.supabaseUrl) != null;
    if (!wanted) {
      _realtime?.stop();
      _realtime = null;
      inbox?.setRealtimeJoined(false);
      return;
    }
    if (_realtime != null) return;
    _realtime = InboxRealtime(
      supabaseUrl: AppConfig.supabaseUrl,
      apiKey: AppConfig.supabasePublishableKey,
      token: () => widget.auth.accessToken(),
      onEvent: inbox.onRealtimeEvent,
      onJoined: () {
        inbox.setRealtimeJoined(true);
        unawaited(inbox.refresh());
      },
      onDown: () => inbox.setRealtimeJoined(false),
    )..start();
  }

  bool _inForeground = true;

  void _openNative(NativeScreen screen, {ClientChoice? newOrderFor, VendorChoice? newPoFor}) {
    if (!mounted || !_shell.signedIn) return;
    _newOrderFor = newOrderFor;
    _newPoFor = newPoFor;
    if (screen != _native) {
      _nativeNavigator = GlobalKey<NavigatorState>();
      _depthObserver = _NativeDepthObserver(_onNativeDepth);
    }
    setState(() {
      _native = screen;
      _nativeDepth = 1;
    });
    _assist?.screenChanged('native:${screen.name}');
    _shell.noteActivity(_sectionFor(screen), force: true);
    _syncRealtime();
    _syncEdgeSwipe();
  }

  void _closeNative() {
    setState(() {
      _native = null;
      _nativeDepth = 0;
    });
    _assist?.screenChanged('page:${_shell.route}');
    _shell.noteActivity(null, force: true);
    _syncRealtime();
    _syncEdgeSwipe();
  }

  void _onNativeDepth(int depth) {
    if (!mounted || depth == _nativeDepth) return;
    setState(() => _nativeDepth = depth);
    _syncEdgeSwipe();
  }

  static String _sectionFor(NativeScreen screen) => switch (screen) {
    NativeScreen.inbox => 'whatsapp-inbox',
    NativeScreen.leads => 'leads',
    NativeScreen.clients => 'clients',
    NativeScreen.templates => 'whatsapp-templates',
    NativeScreen.dashboard => 'whatsapp',
    NativeScreen.waContacts => 'whatsapp-contacts',
    NativeScreen.vendors => 'vendors',
    NativeScreen.salesOrders => 'sales-orders',
    NativeScreen.purchaseOrders => 'purchase-orders',
    NativeScreen.users => 'users',
    NativeScreen.settings => 'settings',
    NativeScreen.emailInbox => 'email-inbox',
    NativeScreen.emailOverview => 'email',
    NativeScreen.emailAnalytics => 'email-analytics',
    NativeScreen.emailCampaigns => 'email-campaigns',
    NativeScreen.emailTemplates => 'email-templates',
    NativeScreen.emailConsent => 'email-consent',
    NativeScreen.emailSettings => 'email-settings',
    NativeScreen.waCampaigns => 'whatsapp-campaigns',
    NativeScreen.deviceContacts => 'whatsapp-contacts',
  };

  void _onDrawerSelected(NavEntry entry) {
    _scaffold.currentState?.closeDrawer();
    final native = entry.native;
    if (native != null) {
      _openNative(native);
    } else if (entry.path != null) {
      if (_native != null) _closeNative();
      _shell.openWebPage(entry.path!);
    }
  }

  /// "New order" on a client: the CRM's sales order form, with that client chosen.
  /// A CRM page asked for from a native screen (New campaign, a campaign's recipients,
  /// the contacts importer). With [backTo], Back from the page returns to that screen.
  void _openWebPageFromNative(String path, {NativeScreen? backTo}) {
    _closeNative();
    _shell.openWebPage(path, via: backTo == null ? null : handoffPathFor(backTo));
  }

  static UsersAbilities _usersAbilities(ShellAccess access) => UsersAbilities(
    userId: access.userId,
    create: access.can('users.create'),
    edit: access.can('users.edit'),
    permissions: access.can('users.permissions'),
    suspend: access.can('users.suspend'),
    sessions: access.can('users.sessions'),
    audit: access.can('audit_logs.view'),
    templates: access.can('templates.manage'),
    departments: access.can('departments.manage'),
  );

  /// Settings saved a change. The page loads the person's access and the
  /// organization's settings again; screens holding the lists load them again.
  void _settingsChanged({required bool organization}) {
    _shell.settingsChanged();
    if (!organization) return;
    unawaited(_salesOrders?.loadChoices());
    unawaited(_purchaseOrders?.loadSettings());
    _clients?.settingsChanged();
    _vendors?.settingsChanged();
  }

  /* ── Email ──────────────────────────────────────────────────────────── */

  Future<void> _openEmailThread(BuildContext context, ThreadSummary thread) async {
    final email = _email;
    final api = _emailApi;
    final access = _shell.access;
    if (email == null || api == null || access == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EmailConversationScreen(
          api: api,
          threadId: thread.id,
          me: access.userId,
          onPatch: email.patch,
          onRemoved: email.drop,
          onCompose: (request) => _composeEmail(context, request),
          onDownload: _downloadAttachment,
          onOpenLink: _openEmailLink,
        ),
      ),
    );
  }

  Future<void> _composeEmail(BuildContext context, ComposeRequest request) async {
    final email = _email;
    final api = _emailApi;
    if (email == null || api == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => EmailComposerScreen(
          api: api,
          platform: widget.platform,
          mailboxes: email.mailboxes ?? const [],
          request: request,
          onSent: () => unawaited(email.load(quiet: true)),
        ),
      ),
    );
  }

  /// An attachment needs the session, which the app's downloader never sends: it is
  /// fetched here into the transfer folder, then saved like any other download.
  Future<void> _downloadAttachment(String threadId, EmailMessage message, EmailAttachment attachment) async {
    final api = _emailApi;
    if (api == null) return;
    final folder = Directory('${widget.info.cacheDir}/transfers');
    final file = File('${folder.path}/email-${DateTime.now().microsecondsSinceEpoch}');
    try {
      await folder.create(recursive: true);
      await api.attachment(threadId, message.id, attachment, into: file);
      await widget.platform.keepFile(path: file.path, view: false, name: attachment.filename, mime: attachment.mime);
    } on ApiException catch (failure) {
      if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(failure.message)));
    }
  }

  /// A link in an email opens in another app, after asking: mail can carry anything.
  Future<void> _openEmailLink(Uri link) async {
    final go = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Open this link?'),
        content: Text(link.toString(), maxLines: 6, overflow: TextOverflow.ellipsis),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialog).pop(true), child: const Text('Open')),
        ],
      ),
    );
    if (go == true && !await widget.platform.openExternal(link.toString()) && mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('No app on this phone can open that link.')));
    }
  }

  /// "New PO" on a vendor: the native Purchase orders screen, its form open with that
  /// vendor chosen (and its address, when it has one).
  void _newPurchaseOrderFor(Vendor vendor) {
    _openNative(NativeScreen.purchaseOrders, newPoFor: VendorChoice(vendor.id, vendor.companyName, alias: vendor.alias));
  }

  /// "New order" on a client: the native Sales orders screen, its form open with that
  /// client chosen.
  void _newOrderForClient(Client client) {
    _openNative(NativeScreen.salesOrders, newOrderFor: ClientChoice(client.companyName, client.contactPerson));
  }

  /// The tax invoice PDF is drawn by the CRM page from its template; Back returns here.
  void _taxInvoiceFor(SalesOrder order) {
    _openWebPageFromNative('/sales-orders/${order.id}/invoice', backTo: NativeScreen.salesOrders);
  }

  void _askForHelp() {
    _scaffold.currentState?.closeDrawer();
    final assist = _assist;
    if (assist != null) {
      unawaited(
        showDialog<void>(
          context: context,
          builder: (_) => AskHelpDialog(c: assist),
        ),
      );
      return;
    }
    if (_native != null) _closeNative();
    _shell.askForHelp();
  }

  /* ── Live Assist ────────────────────────────────────────────────────── */

  /// The person's Live Assist, once their access is known (ADR 0014). The page in the
  /// app leaves Live Assist to it.
  void _startAssist(ShellAccess access, SessionGuard guard) {
    final api = _api!;
    final frames = ScreenFrames(widget.captureKey);
    final assist =
        LiveAssistController(
            api: AssistApi(api),
            userId: access.userId,
            canHelp: access.can('live_assist.use'),
            capture: frames.capture,
            makeLink: ({required sessionId, required sharer, required onData, required onState, onVideo, onFrame}) => WebRtcLink(
              sessionId: sessionId,
              sharer: sharer,
              onData: onData,
              onState: onState,
              onVideo: onVideo,
              onFrame: onFrame,
              signal: ({required onMessage, required onJoined}) => SignalChannel(
                sessionId: sessionId,
                supabaseUrl: AppConfig.supabaseUrl,
                apiKey: AppConfig.supabasePublishableKey,
                token: () => widget.auth.accessToken(),
                onMessage: onMessage,
                onJoined: onJoined,
              ),
            ),
          )
          ..sectionNow = (() => _native != null ? _sectionFor(_native!) : pages.sectionFor(_shell.route))
          ..pageLabel = _pageLabel
          ..onGo = _goToSuggested
          ..addListener(_onAssistChanged);
    _assist = assist;
    guard.onStaffEvent = assist.handleStaffEvent;
    _assistNotices = assist.notices.listen((text) {
      if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));
    });
    widget.assistHost.value = assist;
    _shell.setNativeHelp(offered: true, requested: false);
    unawaited(assist.start());
  }

  void _endAssist() {
    final assist = _assist;
    if (assist == null) return;
    _guard?.onStaffEvent = null;
    assist.removeListener(_onAssistChanged);
    unawaited(_assistNotices?.cancel());
    _assistNotices = null;
    widget.assistHost.value = null;
    _assist = null;
    _shell.clearNativeHelp();
    // After the frame: the layer stops listening to it first.
    WidgetsBinding.instance.addPostFrameCallback((_) => assist.dispose());
  }

  /// A page Dikho has at [path], named; null for any other address.
  static String? _pageLabel(String path) {
    for (final rule in pages.pageRules) {
      if (rule.path == path) return sectionLabels[rule.section] ?? path;
    }
    return null;
  }

  /// "Go" on a helper's suggestion: a native screen when the app has one, else the page,
  /// and only one this person may open.
  /// Google's return after connecting a mailbox in the browser. The app finishes it
  /// with its own session (the page's /email/connect would need the page), then shows
  /// how it ended on native Email settings. False for any other link.
  bool _takeGoogleReturn(Uri uri) {
    if (uri.path != '/email/connect' || !AppConfig.emailHub) return false;
    if (widget.auth.signedIn && _emailApi != null) {
      unawaited(_finishGoogleConnect(uri));
    } else {
      _pendingGoogleReturn = uri;
    }
    return true;
  }

  Future<void> _finishGoogleConnect(Uri uri) async {
    final api = _emailApi;
    if (api == null) return;
    final query = uri.queryParameters;
    var outcome = 'failed';
    try {
      outcome = await api.completeGoogleConnect(state: query['state'] ?? '', code: query['code'], error: query['error']);
    } on ApiException {
      outcome = 'failed';
    }
    if (!mounted) return;
    setState(() => _connectOutcome = outcome);
    _openNative(NativeScreen.emailSettings);
  }

  void _goToSuggested(String? path) {
    final access = _shell.access;
    if (path == null || access == null) return;
    if (!pages.canOpen(access.permissions, access.userId, path)) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Your account does not include that page.')));
      return;
    }
    for (final group in navGroups) {
      for (final entry in group.entries) {
        if (entry.path == path && entry.native != null) {
          _openNative(entry.native!);
          return;
        }
      }
    }
    if (_native != null) _closeNative();
    _shell.openWebPage(path);
  }

  void _onAssistChanged() {
    final assist = _assist;
    if (assist == null || !mounted) return;
    _shell.setNativeHelp(offered: true, requested: assist.myHelp != null);
    final incoming = assist.incoming;
    if (incoming != null && !_incomingOpen && !assist.busy) {
      _incomingOpen = true;
      unawaited(
        showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (dialogContext) => ListenableBuilder(
            listenable: assist,
            builder: (_, _) {
              // Expired or answered elsewhere: the dialog goes.
              if (assist.incoming?.id != incoming.id && assist.sharing == null) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  // Only while it is still the dialog on top, never a route below it.
                  final route = dialogContext.mounted ? ModalRoute.of(dialogContext) : null;
                  if (route != null && route.isCurrent) Navigator.of(dialogContext).pop();
                });
              }
              return IncomingDialog(c: assist, session: incoming);
            },
          ),
        ).whenComplete(() => _incomingOpen = false),
      );
    }
    if (assist.helper != null && !_viewerOpen) {
      _viewerOpen = true;
      _scaffold.currentState?.closeDrawer();
      unawaited(
        widget.navigatorKey.currentState
            ?.push(MaterialPageRoute<void>(fullscreenDialog: true, builder: (_) => HelperViewerScreen(c: assist)))
            .whenComplete(() => _viewerOpen = false),
      );
    }
  }

  void _openDrawer() {
    _releaseFocus();
    _scaffold.currentState?.openDrawer();
  }

  // A focused field would take the keyboard back up as soon as the drawer closes.
  void _releaseFocus() => FocusManager.instance.primaryFocus?.unfocus();

  /// The drawer's swipe, wherever the top level of the app is showing.
  void _syncEdgeSwipe() {
    final on = _shell.signedIn && _updates.required == null && (_native == null || _nativeDepth <= 1);
    if (on == _edgeSwipeOn) return;
    _edgeSwipeOn = on;
    unawaited(widget.platform.setEdgeSwipe(enabled: on).catchError((Object _) {}));
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
    await controller.setUserAgent('$userAgent DikhoCRM/${widget.info.versionName}');

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

    _shell.attachPage(controller.runJavaScript);
    setState(() => _controller = controller);

    final link = await widget.platform.initialLink();
    var start = link != null && _policy.isAllowedDeepLink(link) ? Uri.parse(link) : AppConfig.crmUri;
    if (_takeGoogleReturn(start)) start = AppConfig.crmUri;
    // Nobody signed in yet: the page waits, and the native sign-in shows.
    if (widget.auth.signedIn) {
      _pageForSession = true;
      _load(start);
    } else {
      _pendingStart = start;
      unawaited(controller.loadHtmlString(_blankPage));
    }
  }

  void _load(Uri uri) {
    _lastMainUrl = uri.toString();
    _shell.markPageLoading();
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
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('No app on this phone can open that link.')));
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
    // The page says when it has painted. A page that never does must not stay
    // behind the logo for ever.
    _readyFallback?.cancel();
    _readyFallback = Timer(_readyPatience, _shell.markPageReady);
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
    _shell.markPageReady();
  }

  void _onPlatformEvent(Map<Object?, Object?> event) {
    switch (event['type']) {
      case 'shell':
        final body = event['body'];
        if (body is String) _shell.handleBody(body);
      case 'vault':
        unawaited(_vault.handle(event));
      case 'audio':
        _audio?.onEvent(event);
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
        if (link is String && _policy.isAllowedDeepLink(link) && !_takeGoogleReturn(Uri.parse(link))) {
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
        actions: [FilledButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('OK'))],
      ),
    );
  }

  Future<bool> _onConfirm(JavaScriptConfirmDialogRequest request) async {
    final answer = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        content: Text(request.message),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('OK')),
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
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(field.text), child: const Text('OK')),
        ],
      ),
    );
    field.dispose();
    return answer ?? '';
  }

  Future<List<String>> _pickFiles(FileSelectorParams params) =>
      widget.platform.pickFiles(params.acceptTypes, params.mode == FileSelectorMode.openMultiple);

  /* ── System back ────────────────────────────────────────────────────── */

  Future<void> _onBack() async {
    if (_updates.required != null) {
      await SystemNavigator.pop();
      return;
    }
    if (!widget.auth.signedIn) {
      // From the code back to the email; from there, out of the app.
      if (_signIn.currentState?.handleBack() ?? false) return;
      await SystemNavigator.pop();
      return;
    }
    final scaffold = _scaffold.currentState;
    if (scaffold?.isDrawerOpen ?? false) {
      scaffold!.closeDrawer();
      return;
    }
    final native = _native;
    if (native != null && !_shell.sessionWarning) {
      final navigator = _nativeNavigator.currentState;
      if (navigator != null && await navigator.maybePop()) return;
      // Opened from the drawer over another page: back to that page.
      if (_shell.route != handoffPathFor(native)) {
        _closeNative();
        return;
      }
      // The page is on this screen's own route, so back means the page's history. With
      // none, this is the screen the app opened on, and Back leaves as from any first
      // screen, rather than jumping to some other page.
      if (await _pageBack()) {
        _closeNative();
        return;
      }
    } else {
      final controller = _controller;
      if (controller != null && _state == _LoadState.ready) {
        final Object layer;
        try {
          layer = await controller.runJavaScriptReturningResult(closeTopLayerScript);
        } on PlatformException {
          return;
        }
        if (layer.toString().contains('layer')) return;
      }
      if (await _pageBack()) return;
    }
    final now = DateTime.now();
    final last = _lastBackPress;
    if (last != null && now.difference(last) < _exitWindow) {
      await SystemNavigator.pop();
      return;
    }
    _lastBackPress = now;
    if (mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Press back again to exit'), duration: _exitWindow));
    }
  }

  /// One step back in the page, if it has anywhere to go.
  Future<bool> _pageBack() async {
    final controller = _controller;
    if (controller == null || _state != _LoadState.ready) return false;
    try {
      final moved = await controller.runJavaScriptReturningResult(pageBackScript);
      if (moved.toString().contains('went')) return true;
    } on PlatformException {
      // The page cannot answer, so the WebView's own history decides.
    }
    if (await controller.canGoBack()) {
      await controller.goBack();
      return true;
    }
    return false;
  }

  /* ── App lifecycle ──────────────────────────────────────────────────── */

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      // From the first sign of leaving: Android can delay the later states.
      _awaySince ??= DateTime.now();
      _inForeground = false;
      _guard?.foreground(false);
      _assist?.setForeground(false);
      _syncRealtime();
      return;
    }
    final awaySince = _awaySince;
    _awaySince = null;
    _inForeground = true;
    widget.auth.resumed();
    _guard?.foreground(true);
    _assist?.setForeground(true);
    // Anything asked while the app was away (the channel only runs in the foreground).
    if (_assist != null) unawaited(_assist!.start());
    _syncRealtime();
    if (_native == NativeScreen.inbox) unawaited(_inbox?.refresh());
    unawaited(_updates.onResumed());
    unawaited(_updates.checkIfDue());
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
      final busy = await controller.runJavaScriptReturningResult(pageIsBusyScript);
      if (!busy.toString().contains('busy')) {
        _shell.markPageLoading();
        _readyFallback?.cancel();
        _readyFallback = Timer(_firstLoadPatience, _shell.markPageReady);
        await controller.reload();
      }
    } on PlatformException {
      // The page is gone or still loading: nothing to refresh.
    }
  }

  /* ── Layout ─────────────────────────────────────────────────────────── */

  @override
  Widget build(BuildContext context) {
    final required = _updates.required;
    final failed = _unsupportedWebView || _state == _LoadState.failed;
    final access = _shell.access;
    final signedIn = access != null;
    final nativeOnTop = _native != null && !_shell.sessionWarning;
    final splashUp = !failed && !_shell.pageReady;
    final surface = Theme.of(context).colorScheme.surface;

    // The bars match whatever is on screen: the page's own edges on the sign-in
    // screen, the native surface everywhere else.
    final Color top;
    final Color bottom;
    if (required != null || failed || nativeOnTop || signedIn) {
      top = surface;
      bottom = nativeOnTop || required != null || failed ? surface : _pageBottom;
    } else if (splashUp) {
      top = bottom = DikhoColors.surfaceLight;
    } else {
      top = _pageTop;
      bottom = _pageBottom;
    }
    final controller = _controller;
    final showTopBar = signedIn && !nativeOnTop && !failed && required == null;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: Colors.transparent,
        statusBarIconBrightness: _iconsOn(top),
        statusBarBrightness: ThemeData.estimateBrightnessForColor(top),
        systemNavigationBarIconBrightness: _iconsOn(bottom),
      ),
      child: Listener(
        // Taps on native screens count as activity, or the page would sign out
        // someone who is busy answering chats.
        behavior: HitTestBehavior.translucent,
        onPointerDown: (_) {
          final native = _native;
          if (native != null) _shell.noteActivity(_sectionFor(native));
          _guard?.noteActivity(native != null ? _sectionFor(native) : pages.sectionFor(_shell.route));
        },
        child: PopScope(
          canPop: false,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) unawaited(_onBack());
          },
          child: Scaffold(
            key: _scaffold,
            backgroundColor: bottom,
            // The native screens handle the keyboard themselves.
            resizeToAvoidBottomInset: !nativeOnTop,
            drawer: signedIn && required == null
                ? AppDrawer(
                    access: access,
                    route: _shell.route,
                    native: _native,
                    unreadChats: _inbox?.unreadTotal ?? 0,
                    versionName: widget.info.versionName,
                    onSelect: _onDrawerSelected,
                    onAskForHelp: _askForHelp,
                    onSignOut: () {
                      _scaffold.currentState?.closeDrawer();
                      unawaited(widget.auth.signOut());
                    },
                  )
                : null,
            drawerEdgeDragWidth: 32,
            drawerEnableOpenDragGesture: signedIn && (_native == null || _nativeDepth <= 1),
            onDrawerChanged: (open) {
              if (!open) return;
              _releaseFocus();
              if (_inbox?.hasLoaded == false) unawaited(_inbox?.reload());
            },
            body: Stack(
              children: [
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  height: MediaQuery.paddingOf(context).top,
                  child: ColoredBox(color: top),
                ),
                // Under a required update nothing may be reachable, and that includes
                // through TalkBack, which ignores what is painted on top.
                ExcludeSemantics(
                  excluding: required != null,
                  child: SafeArea(
                    child: Column(
                      children: [
                        if (showTopBar) _WebTopBar(onMenu: _openDrawer),
                        Expanded(
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              if (controller != null)
                                Offstage(
                                  offstage: nativeOnTop,
                                  child: WebViewWidget.fromPlatformCreationParams(
                                    params: AndroidWebViewWidgetCreationParams(controller: controller.platform, displayWithHybridComposition: true),
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
                                  onAction: () => unawaited(_openExternal(_webViewListing)),
                                )
                              else if (_state == _LoadState.failed)
                                LoadFailureView(
                                  title: _serverFailed ? 'Dikho CRM is not responding' : "Can't reach Dikho CRM",
                                  message: _serverFailed
                                      ? 'This is a problem on our side, not with your '
                                            'phone. Please try again in a minute.'
                                      : 'Check your internet connection. This page will '
                                            'try again by itself when you are back online.',
                                  onAction: _retry,
                                ),
                              // Kept while a session warning shows, so answering it
                              // does not lose the open chat or a half-typed reply.
                              if (_native != null && access != null) Offstage(offstage: !nativeOnTop, child: _nativeLayer(access)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Positioned.fill(
                  child: IgnorePointer(
                    ignoring: !splashUp,
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 220),
                      child: splashUp ? _Splash(slow: _slow, onRetry: _retry) : const SizedBox.shrink(),
                    ),
                  ),
                ),
                // Not over the WebView explanation: without a WebView that works, signing
                // in would lead nowhere.
                if (widget.auth.state == AuthState.signedOut && !_unsupportedWebView)
                  Positioned.fill(
                    child: SignInScreen(key: _signIn, auth: widget.auth),
                  ),
                if (required != null)
                  Positioned.fill(
                    child: UpdateRequiredScreen(controller: required, onCheckAgain: () => _updates.checkIfDue(force: true)),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _nativeLayer(ShellAccess access) {
    final screen = _native!;
    final inbox = _inbox!;
    return InboxScope(
      inbox: inbox,
      api: _inboxApi!,
      media: _media!,
      audio: _audio!,
      platform: widget.platform,
      access: access,
      child: ScaffoldMessenger(
        child: HeroControllerScope.none(
          child: Navigator(
            key: _nativeNavigator,
            observers: [_depthObserver],
            onGenerateInitialRoutes: (_, _) => [
              MaterialPageRoute<void>(
                builder: (_) => switch (screen) {
                  NativeScreen.inbox => ChatListScreen(key: const ValueKey('inbox'), onOpenDrawer: _openDrawer),
                  NativeScreen.clients =>
                    _clients == null
                        ? const _NativeUnavailable()
                        : ClientsScreen(
                            key: const ValueKey('clients'),
                            controller: _clients!,
                            platform: widget.platform,
                            abilities: ClientAbilities(
                              create: access.can('clients.create'),
                              edit: access.can('clients.edit'),
                              newOrder: access.can('sales_orders.create') && access.mayOpen('/sales-orders'),
                            ),
                            onOpenDrawer: _openDrawer,
                            onNewOrder: _newOrderForClient,
                          ),
                  NativeScreen.templates => TemplatesScreen(key: const ValueKey('templates'), api: _api!, onOpenDrawer: _openDrawer),
                  NativeScreen.dashboard => DashboardScreen(
                    key: const ValueKey('dashboard'),
                    api: _api!,
                    canSend: access.can('campaigns.send') && access.mayOpen('/whatsapp/campaigns'),
                    onOpenDrawer: _openDrawer,
                    onOpenWebPage: _openWebPageFromNative,
                    platform: widget.platform,
                    onOpenInbox: access.mayOpen('/whatsapp/inbox') ? () => _openNative(NativeScreen.inbox) : null,
                  ),
                  NativeScreen.leads =>
                    _leads == null
                        ? const _NativeUnavailable()
                        : LeadsScreen(key: const ValueKey('leads'), controller: _leads!, platform: widget.platform, onOpenDrawer: _openDrawer),
                  NativeScreen.salesOrders =>
                    _salesOrders == null
                        ? const _NativeUnavailable()
                        : SalesOrdersScreen(
                            key: const ValueKey('sales-orders'),
                            controller: _salesOrders!,
                            platform: widget.platform,
                            abilities: SalesOrderAbilities(
                              create: access.can('sales_orders.create'),
                              editScope: access.scopeOf('sales_orders.edit'),
                              userId: access.userId,
                              createdBy: access.name.isNotEmpty ? access.name : (access.email.isEmpty ? null : access.email),
                            ),
                            onOpenDrawer: _openDrawer,
                            onTaxInvoice: _taxInvoiceFor,
                            newOrderFor: _newOrderFor,
                          ),
                  NativeScreen.purchaseOrders =>
                    _purchaseOrders == null
                        ? const _NativeUnavailable()
                        : PurchaseOrdersScreen(
                            key: const ValueKey('purchase-orders'),
                            controller: _purchaseOrders!,
                            platform: widget.platform,
                            abilities: PurchaseOrderAbilities(
                              create: access.can('purchase_orders.create'),
                              edit: access.can('purchase_orders.edit'),
                              createdBy: access.name.isNotEmpty ? access.name : (access.email.isEmpty ? null : access.email),
                            ),
                            onOpenDrawer: _openDrawer,
                            newOrderFor: _newPoFor,
                          ),
                  NativeScreen.users => UsersScreen(
                    key: const ValueKey('users'),
                    controller: _users!,
                    abilities: _usersAbilities(access),
                    onOpenDrawer: _openDrawer,
                    assist: _assist,
                  ),
                  NativeScreen.emailOverview =>
                    _emailApi == null
                        ? const _NativeUnavailable()
                        : EmailOverviewScreen(
                            key: const ValueKey('email'),
                            api: _emailApi!,
                            abilities: EmailAbilities(
                              userId: access.userId,
                              inbox: access.can('email_inbox.view'),
                              mailboxes: access.can('email_mailboxes.manage'),
                              campaigns:
                                  access.can('email_campaigns.view') || access.can('email_campaigns.create') || access.can('email_campaigns.approve'),
                              approve: access.can('email_campaigns.approve'),
                            ),
                            onOpenDrawer: _openDrawer,
                            onOpenInbox: () => _openNative(NativeScreen.emailInbox),
                            onOpenThread: _openEmailThread,
                            onOpenPage: _goToSuggested,
                          ),
                  NativeScreen.emailAnalytics =>
                    _emailApi == null
                        ? const _NativeUnavailable()
                        : EmailAnalyticsScreen(key: const ValueKey('email-analytics'), api: _emailApi!, onOpenDrawer: _openDrawer),
                  NativeScreen.emailCampaigns =>
                    _emailApi == null
                        ? const _NativeUnavailable()
                        : EmailCampaignsScreen(
                            key: const ValueKey('email-campaigns'),
                            api: _emailApi!,
                            userId: access.userId,
                            canCreate: access.can('email_campaigns.create'),
                            onOpenDrawer: _openDrawer,
                            onOpenPage: _goToSuggested,
                          ),
                  NativeScreen.emailTemplates =>
                    _emailApi == null
                        ? const _NativeUnavailable()
                        : EmailTemplatesScreen(
                            key: const ValueKey('email-templates'),
                            api: _emailApi!,
                            canManage: access.can('email_templates.manage'),
                            onOpenDrawer: _openDrawer,
                          ),
                  NativeScreen.emailSettings =>
                    _emailApi == null
                        ? const _NativeUnavailable()
                        : EmailSettingsScreen(
                            key: const ValueKey('email-settings'),
                            api: _emailApi!,
                            me: access.userId,
                            myEmail: access.email,
                            openExternal: widget.platform.openExternal,
                            outcome: _connectOutcome,
                            onOpenDrawer: _openDrawer,
                          ),
                  NativeScreen.emailConsent =>
                    _emailApi == null
                        ? const _NativeUnavailable()
                        : EmailConsentScreen(
                            key: const ValueKey('email-consent'),
                            api: _emailApi!,
                            canManage: access.can('email_consent.manage'),
                            onOpenDrawer: _openDrawer,
                          ),
                  NativeScreen.emailInbox =>
                    _email == null
                        ? const _NativeUnavailable()
                        : EmailInboxScreen(
                            key: const ValueKey('email-inbox'),
                            controller: _email!,
                            me: access.userId,
                            onOpenDrawer: _openDrawer,
                            onOpenThread: _openEmailThread,
                            onCompose: (context) =>
                                unawaited(_composeEmail(context, ComposeRequest(mode: 'new', accountId: _email!.mailboxId ?? ''))),
                          ),
                  NativeScreen.settings =>
                    _settings == null
                        ? const _NativeUnavailable()
                        : SettingsScreen(
                            key: const ValueKey('settings'),
                            controller: _settings!,
                            users: _users!,
                            usersAbilities: _usersAbilities(access),
                            shell: _shell,
                            abilities: SettingsAbilities(
                              access: access,
                              manage: access.can('settings.manage'),
                              viewUsers: access.can('users.view') && access.mayOpen('/users'),
                              emailHub: AppConfig.emailHub,
                            ),
                            onOpenDrawer: _openDrawer,
                            onOpenUsers: () => _openNative(NativeScreen.users),
                          ),
                  NativeScreen.vendors =>
                    _vendors == null
                        ? const _NativeUnavailable()
                        : VendorsScreen(
                            key: const ValueKey('vendors'),
                            controller: _vendors!,
                            platform: widget.platform,
                            abilities: VendorAbilities(
                              create: access.can('vendors.create'),
                              edit: access.can('vendors.edit'),
                              newPurchaseOrder: access.can('purchase_orders.create') && access.mayOpen('/purchase-orders'),
                            ),
                            onOpenDrawer: _openDrawer,
                            onNewPurchaseOrder: _newPurchaseOrderFor,
                          ),
                  NativeScreen.waCampaigns => CampaignsScreen(
                    key: const ValueKey('wa-campaigns'),
                    api: _api!,
                    platform: widget.platform,
                    canSend: access.can('campaigns.send'),
                    onOpenDrawer: _openDrawer,
                    // A campaign's recipient list is a CRM page; Back returns to this list.
                    onOpenWebPage: (path) => _openWebPageFromNative(path, backTo: NativeScreen.waCampaigns),
                  ),
                  NativeScreen.waContacts => ContactsScreen(
                    key: const ValueKey('wa-contacts'),
                    controller: _contacts!,
                    platform: widget.platform,
                    inboxApi: _inboxApi!,
                    abilities: ContactAbilities(
                      delete: access.can('wa_contacts.delete'),
                      import: access.can('wa_contacts.import'),
                      sendTemplates: access.can('campaigns.send'),
                    ),
                    onOpenDrawer: _openDrawer,
                    // The web importer, on a route the page keeps for itself.
                    onImport: () => _openWebPageFromNative('/whatsapp/contacts/import', backTo: NativeScreen.waContacts),
                  ),
                  NativeScreen.deviceContacts => DeviceContactsScreen(
                    key: const ValueKey('contacts'),
                    platform: widget.platform,
                    api: _inboxApi!,
                    canSendTemplates: access.can('campaigns.send'),
                    onOpenDrawer: _openDrawer,
                  ),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Counts the routes in the native screens' navigator, so the drawer's swipe works
/// only on a top-level screen and never fights a screen opened over it.
class _NativeDepthObserver extends NavigatorObserver {
  _NativeDepthObserver(this.onChanged);

  final ValueChanged<int> onChanged;
  int _depth = 0;

  void _set(int depth) {
    _depth = depth;
    onChanged(depth);
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (route is PageRoute) _set(_depth + 1);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (route is PageRoute) _set(_depth - 1);
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (route is PageRoute) _set(_depth - 1);
  }
}

/// A native screen that cannot run because the page reported no usable project
/// address. Never expected: the page always reports one.
class _NativeUnavailable extends StatelessWidget {
  const _NativeUnavailable();

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(),
    body: const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Text('This screen is not available right now. Please close the app and open it again.', textAlign: TextAlign.center),
      ),
    ),
  );
}

/// Above every CRM page, in place of the page's own top bar.
class _WebTopBar extends StatelessWidget {
  const _WebTopBar({required this.onMenu});

  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(bottom: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      child: SizedBox(
        height: 56,
        child: Row(
          children: [
            const SizedBox(width: 4),
            IconButton(tooltip: 'Open menu', onPressed: onMenu, icon: const Icon(Icons.menu)),
            const SizedBox(width: 4),
            Image.asset('assets/brand/logo.png', height: 24, semanticLabel: 'Dikho'),
          ],
        ),
      ),
    );
  }
}

Brightness _iconsOn(Color ground) => ThemeData.estimateBrightnessForColor(ground) == Brightness.dark ? Brightness.light : Brightness.dark;

/// The same white ground and mark as Android's own launch screen, so the hand-over
/// shows no flash, and the same sequence the CRM's boot splash plays in a browser.
/// Drawn from paths compiled into the app: nothing here waits on the network.
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
            const LogoAnimation(width: 168),
            if (slow) ...[
              const SizedBox(height: 28),
              const Text('This is taking longer than usual.', style: TextStyle(color: DikhoColors.mutedLight)),
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
