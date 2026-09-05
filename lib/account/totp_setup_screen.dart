import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../auth/auth_service.dart';

/// Turns on two-factor authentication: shows the secret for an
/// authenticator app (as a QR code for another device, a button that opens
/// an app on this one, and the key to type by hand), then asks for the
/// first code the app shows to prove it. Pops with `true` once enrolled.
class TotpSetupScreen extends StatefulWidget {
  const TotpSetupScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<TotpSetupScreen> createState() => _TotpSetupScreenState();
}

class _TotpSetupScreenState extends State<TotpSetupScreen> {
  final _code = TextEditingController();
  TotpEnrollment? _enrollment;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _enrollment = null;
      _error = null;
    });
    try {
      final enrollment = await widget.auth.startTotpEnrollment();
      if (mounted) setState(() => _enrollment = enrollment);
    } on AuthException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _finish() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _error = 'Enter the 6-digit code from the app.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.auth.finishTotpEnrollment(code);
      if (mounted) Navigator.of(context).pop(true);
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openApp(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'No authenticator app found. Scan the code or enter the key.',
          ),
        ),
      );
    }
  }

  Future<void> _copyKey(String key) async {
    await Clipboard.setData(ClipboardData(text: key));
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Key copied.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final enrollment = _enrollment;
    final error = _error;

    final Widget body;
    if (enrollment == null) {
      body = Center(
        child: error == null
            ? const CircularProgressIndicator()
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(error, textAlign: TextAlign.center),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: _start,
                    child: const Text('Try again'),
                  ),
                ],
              ),
      );
    } else {
      body = ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Add bikes.pizza to an authenticator app (Google Authenticator, '
            '1Password, Authy…), then enter the 6-digit code it shows.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          FilledButton.tonalIcon(
            key: const Key('open-authenticator'),
            onPressed: () => _openApp(enrollment.qrCodeUrl),
            icon: const Icon(Icons.open_in_new),
            label: const Text('Open in authenticator app'),
          ),
          const SizedBox(height: 16),
          Center(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
              ),
              child: QrImageView(
                data: enrollment.qrCodeUrl,
                size: 192,
                backgroundColor: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Scan with an app on another device, or enter this key by hand:',
            style: theme.textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
          TextButton.icon(
            key: const Key('copy-key'),
            onPressed: () => _copyKey(enrollment.secretKey),
            icon: const Icon(Icons.copy, size: 16),
            label: Text(
              enrollment.secretKey,
              style: const TextStyle(fontFamily: 'monospace'),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            key: const Key('totp-code'),
            controller: _code,
            enabled: !_busy,
            keyboardType: TextInputType.number,
            maxLength: 6,
            autofillHints: const [AutofillHints.oneTimeCode],
            onSubmitted: (_) => _finish(),
            decoration: const InputDecoration(
              labelText: 'Code from the app',
              border: OutlineInputBorder(),
            ),
          ),
          if (error != null) ...[
            const SizedBox(height: 8),
            Text(error, style: TextStyle(color: theme.colorScheme.error)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('totp-finish'),
            onPressed: _busy ? null : _finish,
            child: const Text('Turn on two-factor authentication'),
          ),
        ],
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Two-factor authentication')),
      body: body,
    );
  }
}
