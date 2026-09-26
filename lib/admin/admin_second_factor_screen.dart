import 'package:flutter/material.dart';

import '../account/totp_setup_screen.dart';
import '../auth/auth_service.dart';
import '../auth/passkey_service.dart';

/// Shown to an administrator whose session was not established with a
/// second factor. The admin screens and the API refuse such sessions, so
/// this cannot be backed out of: add a passkey (the recommended way; it
/// signs the admin in again on the spot), set up an authenticator app
/// (after which the admin signs in again with its code), or sign out.
class AdminSecondFactorScreen extends StatefulWidget {
  const AdminSecondFactorScreen({super.key, required this.auth, this.passkeys});

  final AuthService auth;
  final PasskeyService? passkeys;

  @override
  State<AdminSecondFactorScreen> createState() =>
      _AdminSecondFactorScreenState();
}

class _AdminSecondFactorScreenState extends State<AdminSecondFactorScreen> {
  bool _passkeysAvailable = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.passkeys?.available.then((available) {
      if (mounted) setState(() => _passkeysAvailable = available);
    });
  }

  Future<void> _addPasskey() async {
    final passkeys = widget.passkeys!;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await passkeys.add();
      // A passkey sign-in mints a token that carries the second factor, so
      // the admin is signed in again with the key just added.
      final signedIn = await passkeys.signIn(
        email: widget.auth.currentUser?.email,
        onlyIfPresent: true,
      );
      if (!mounted) return;
      if (signedIn) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              "Passkey added. You're signed in as an administrator.",
            ),
          ),
        );
        return;
      }
      setState(
        () => _error =
            'The passkey was added. Sign out, then sign in again with it.',
      );
    } on PasskeyException catch (e) {
      if (!e.cancelled) setState(() => _error = e.message);
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _setUpAuthenticator() async {
    final enrolled = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => TotpSetupScreen(auth: widget.auth)),
    );
    if (!mounted || enrolled != true) return;
    // Only a sign-in that presents the code produces a token with the
    // second factor, so the current session is ended here.
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    await widget.auth.signOut();
    if (!mounted) return;
    navigator.pop();
    messenger.showSnackBar(
      const SnackBar(
        content: Text(
          'Two-factor authentication is on. Sign in again with the code '
          'from your authenticator app.',
        ),
      ),
    );
  }

  Future<void> _signOut() async {
    final navigator = Navigator.of(context);
    await widget.auth.signOut();
    if (mounted) navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final error = _error;
    return PopScope(
      canPop: false,
      child: Scaffold(
        key: const Key('admin-2fa'),
        appBar: AppBar(
          title: const Text('Two-factor sign-in needed'),
          automaticallyImplyLeading: false,
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(
                Icons.admin_panel_settings_outlined,
                size: 48,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: 16),
              Text(
                'Administrator accounts sign in with a second factor.',
                style: theme.textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Text(
                'A passkey is the easiest: your face, fingerprint or screen '
                'lock confirms it, and it signs you in as an administrator '
                'right away. An authenticator app works too; after setting '
                'it up you sign in again with its code.',
                style: theme.textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
              if (error != null) ...[
                const SizedBox(height: 16),
                Text(
                  error,
                  style: TextStyle(color: theme.colorScheme.error),
                  textAlign: TextAlign.center,
                ),
              ],
              const SizedBox(height: 24),
              if (widget.passkeys != null && _passkeysAvailable) ...[
                FilledButton.icon(
                  key: const Key('admin-2fa-passkey'),
                  onPressed: _busy ? null : _addPasskey,
                  icon: const Icon(Icons.fingerprint),
                  label: const Text('Add a passkey (recommended)'),
                ),
                const SizedBox(height: 8),
              ],
              OutlinedButton.icon(
                key: const Key('admin-2fa-totp'),
                onPressed: _busy ? null : _setUpAuthenticator,
                icon: const Icon(Icons.qr_code_2),
                label: const Text('Set up an authenticator app'),
              ),
              const SizedBox(height: 8),
              TextButton(
                key: const Key('admin-2fa-sign-out'),
                onPressed: _busy ? null : _signOut,
                child: const Text('Sign out'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
