import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../inbox/chat_theme.dart';

/// One received message's body, as EmailFrame.jsx shows it on the web: the HTML the
/// server has already cleaned (no scripts, remote images held back), in its own small
/// web view that can load nothing. Its content policy allows no network and no script,
/// it never navigates (a tapped link is offered to another app, after asking), and
/// nothing in it can reach the app. Without a web view (tests) the plain text shows.
class MessageBody extends StatefulWidget {
  const MessageBody({super.key, required this.html, required this.text, required this.onOpenLink});

  final String html;
  final String text;

  /// A link the person chose to open, in another app.
  final Future<void> Function(Uri link) onOpenLink;

  /// The page the web view is given: the message inside a document whose policy
  /// blocks every load except inline styles and embedded pictures.
  static String document(String html) =>
      '<!doctype html><html><head><meta charset="utf-8">'
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:">'
      '<meta name="viewport" content="width=device-width, initial-scale=1">'
      '<style>html,body{margin:0;padding:0;background:#fff;color:#202124;font:15px/1.45 sans-serif;overflow-wrap:anywhere}'
      'img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>'
      '</head><body>$html</body></html>';

  @override
  State<MessageBody> createState() => _MessageBodyState();
}

class _MessageBodyState extends State<MessageBody> {
  WebViewController? _web;
  double _height = 120;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    if (WebViewPlatform.instance == null || widget.html.isEmpty) return;
    final page = MessageBody.document(widget.html);
    _web = WebViewController()
      // Only for measuring the height from here: the document's own policy lets no
      // script of its own run.
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            if (!_loaded) return NavigationDecision.navigate;
            final link = Uri.tryParse(request.url);
            if (link != null && const {'http', 'https', 'mailto', 'tel'}.contains(link.scheme)) unawaited(widget.onOpenLink(link));
            return NavigationDecision.prevent;
          },
          onPageFinished: (_) => unawaited(_measure()),
        ),
      )
      ..loadRequest(Uri.dataFromString(page, mimeType: 'text/html', encoding: utf8));
  }

  Future<void> _measure() async {
    _loaded = true;
    final web = _web;
    if (web == null) return;
    try {
      final result = await web.runJavaScriptReturningResult('document.documentElement.scrollHeight');
      final height = result is num ? result.toDouble() : double.tryParse('$result');
      if (height != null && mounted) setState(() => _height = height.clamp(40, 20000).toDouble() + 8);
    } on Object {
      // The fallback height stays; the message scrolls inside its frame.
    }
  }

  @override
  Widget build(BuildContext context) {
    final web = _web;
    if (web == null) {
      return SelectableText(widget.text.isEmpty ? '(no text)' : widget.text);
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        height: _height,
        child: Stack(
          children: [
            WebViewWidget(controller: web),
            if (!_loaded)
              const Positioned.fill(
                child: ColoredBox(
                  color: Colors.white,
                  child: Center(
                    child: SizedBox(width: Gap.xl, height: Gap.xl, child: CircularProgressIndicator(strokeWidth: 2)),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
