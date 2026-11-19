import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../inbox/chat_theme.dart';
import 'auth_api.dart';
import 'auth_controller.dart';

const defaultCountryCode = '91';

/// A typed number as E.164, as toE164 in src/features/auth/Login.jsx (and the API's
/// phone rules) make it: ten digits are Indian, a leading 0 is dropped, anything
/// longer already carries its country code. Null when it cannot be a number.
String? toE164(String input) {
  final digits = input.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) return null;
  if (digits.length == 10) return '+$defaultCountryCode$digits';
  if (digits.length == 11 && digits.startsWith('0')) return '+$defaultCountryCode${digits.substring(1)}';
  if (digits.length >= 11 && digits.length <= 15) return '+$digits';
  return null;
}

enum SignInMethod { email, whatsapp }

/// Signing in, drawn by the app: a six-digit code by email or WhatsApp, for people the
/// organization has already added. Nobody can create an account here.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, required this.auth, this.resendAfter = const Duration(seconds: 60)});

  final AuthController auth;
  final Duration resendAfter;

  @override
  State<SignInScreen> createState() => SignInScreenState();
}

class SignInScreenState extends State<SignInScreen> {
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _codeFocus = FocusNode();
  SignInMethod _method = SignInMethod.email;
  bool _codeStep = false;
  bool _busy = false;
  String? _error;

  /// What the code was sent to, exactly: verify and resend use the same value.
  String _sentTo = '';
  int _wait = 0;
  Timer? _countdown;

  AuthApi get _api => widget.auth.api;

  @override
  void dispose() {
    _email.dispose();
    _phone.dispose();
    _code.dispose();
    _codeFocus.dispose();
    _countdown?.cancel();
    super.dispose();
  }

  void _startCountdown() {
    _countdown?.cancel();
    setState(() => _wait = widget.resendAfter.inSeconds);
    _countdown = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return timer.cancel();
      setState(() => _wait = _wait > 0 ? _wait - 1 : 0);
      if (_wait == 0) timer.cancel();
    });
  }

  /// Asks for a code; true when one is on its way.
  Future<bool> _request() async {
    final String target;
    if (_method == SignInMethod.whatsapp) {
      final number = toE164(_phone.text);
      if (number == null) {
        setState(() => _error = 'Enter a valid phone number.');
        return false;
      }
      target = number;
    } else {
      final email = _email.text.trim();
      if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
        setState(() => _error = 'Enter your full email address.');
        return false;
      }
      target = email;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_method == SignInMethod.whatsapp) {
        await _api.sendCode(phone: target);
      } else {
        await _api.sendCode(email: target);
      }
      _sentTo = target;
      return true;
    } on AuthFailure catch (failure) {
      if (mounted) setState(() => _error = failure.message);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    FocusManager.instance.primaryFocus?.unfocus();
    if (!await _request() || !mounted) return;
    setState(() {
      _codeStep = true;
      _code.clear();
    });
    _startCountdown();
    _codeFocus.requestFocus();
  }

  Future<void> _resend() async {
    _code.clear();
    if (!await _request() || !mounted) return;
    _startCountdown();
    _codeFocus.requestFocus();
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('A new code is on its way.')));
  }

  Future<void> _verify() async {
    final code = _code.text.replaceAll(RegExp(r'\D'), '');
    if (code.length != 6 || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final session = _method == SignInMethod.whatsapp
          ? await _api.verify(phone: _sentTo, code: code)
          : await _api.verify(email: _sentTo, code: code);
      await widget.auth.signedInWith(session);
    } on AuthFailure catch (failure) {
      if (!mounted) return;
      setState(() => _error = failure.message);
      _code.clear();
      _codeFocus.requestFocus();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Back on the code step returns to the email or number. True when it did; the
  /// screen that holds this one decides what Back means otherwise.
  bool handleBack() {
    if (!_codeStep) return false;
    _back();
    return true;
  }

  void _back() {
    _countdown?.cancel();
    setState(() {
      _codeStep = false;
      _error = null;
      _wait = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Gap.xl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(child: Image.asset('assets/brand/logo.png', height: 44, semanticLabel: 'Dikho')),
                    const SizedBox(height: Gap.xl),
                    if (_codeStep) ..._codeChildren(theme) else ..._entryChildren(theme),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _errorText(ThemeData theme) => Padding(
    padding: const EdgeInsets.only(top: Gap.s),
    child: Semantics(
      liveRegion: true,
      child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
    ),
  );

  List<Widget> _entryChildren(ThemeData theme) {
    final whatsapp = _method == SignInMethod.whatsapp;
    final notice = widget.auth.notice;
    return [
      Text('Sign in to Dikho CRM', textAlign: TextAlign.center, style: theme.textTheme.headlineSmall),
      const SizedBox(height: Gap.s),
      Text(
        whatsapp ? "We'll send a 6-digit code to your WhatsApp." : "We'll email you a 6-digit code.",
        textAlign: TextAlign.center,
        style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
      ),
      if (notice != null) ...[
        const SizedBox(height: Gap.l),
        Container(
          padding: const EdgeInsets.all(Gap.m),
          decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.info_outline, size: 20),
              const SizedBox(width: Gap.s),
              Expanded(child: Text(notice)),
            ],
          ),
        ),
      ],
      const SizedBox(height: Gap.xl),
      SegmentedButton<SignInMethod>(
        showSelectedIcon: false,
        segments: const [
          ButtonSegment(value: SignInMethod.email, icon: Icon(Icons.mail_outline), label: Text('Email')),
          ButtonSegment(value: SignInMethod.whatsapp, icon: Icon(Icons.chat_outlined), label: Text('WhatsApp')),
        ],
        selected: {_method},
        onSelectionChanged: _busy
            ? null
            : (value) => setState(() {
                _method = value.first;
                _error = null;
              }),
      ),
      const SizedBox(height: Gap.l),
      if (whatsapp)
        TextField(
          key: const ValueKey('phone'),
          controller: _phone,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          textInputAction: TextInputAction.send,
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]'))],
          onSubmitted: (_) => unawaited(_send()),
          decoration: const InputDecoration(labelText: 'WhatsApp number', helperText: '10 digits for India, or the number with its country code'),
        )
      else
        TextField(
          key: const ValueKey('email'),
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          autocorrect: false,
          textInputAction: TextInputAction.send,
          onSubmitted: (_) => unawaited(_send()),
          decoration: const InputDecoration(labelText: 'Work email'),
        ),
      if (_error != null) _errorText(theme),
      const SizedBox(height: Gap.l),
      FilledButton(
        onPressed: _busy ? null : () => unawaited(_send()),
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
        child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Send code'),
      ),
      const SizedBox(height: Gap.l),
      Text(
        'Only people your organization has added can sign in.',
        textAlign: TextAlign.center,
        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      ),
    ];
  }

  List<Widget> _codeChildren(ThemeData theme) {
    final whatsapp = _method == SignInMethod.whatsapp;
    return [
      Text(whatsapp ? 'Check WhatsApp' : 'Check your email', textAlign: TextAlign.center, style: theme.textTheme.headlineSmall),
      const SizedBox(height: Gap.s),
      Text.rich(
        TextSpan(
          children: [
            const TextSpan(text: 'We sent a 6-digit code to '),
            TextSpan(
              text: _sentTo,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const TextSpan(text: '.'),
          ],
        ),
        textAlign: TextAlign.center,
        style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
      ),
      const SizedBox(height: Gap.xl),
      TextField(
        controller: _code,
        focusNode: _codeFocus,
        // Never disabled while the code is checked: that drops the focus and the
        // keyboard, and the next code typed would go nowhere. _verify ignores a second go.
        autofocus: true,
        keyboardType: TextInputType.number,
        autofillHints: const [AutofillHints.oneTimeCode],
        textAlign: TextAlign.center,
        maxLength: 6,
        style: theme.textTheme.headlineMedium?.copyWith(letterSpacing: 12, fontFeatures: const [FontFeature.tabularFigures()]),
        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
        onChanged: (value) {
          if (_error != null) setState(() => _error = null);
          if (value.length == 6) unawaited(_verify());
        },
        decoration: const InputDecoration(labelText: 'Code', counterText: ''),
      ),
      if (_error != null) _errorText(theme),
      const SizedBox(height: Gap.l),
      FilledButton(
        onPressed: _busy ? null : () => unawaited(_verify()),
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
        child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Sign in'),
      ),
      const SizedBox(height: Gap.m),
      TextButton(
        onPressed: _busy || _wait > 0 ? null : () => unawaited(_resend()),
        child: Text(_wait > 0 ? 'Send a new code in $_wait s' : 'Send a new code'),
      ),
      TextButton(onPressed: _busy ? null : _back, child: Text(whatsapp ? 'Use a different number' : 'Use a different email')),
    ];
  }
}
