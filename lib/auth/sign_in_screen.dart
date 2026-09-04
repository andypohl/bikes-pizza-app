import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform;
import 'package:flutter/material.dart';

import 'auth_service.dart';

enum _Mode { signIn, createAccount }

/// Email + password sign-in, with a toggle to create a new account and a
/// password-reset link. Pops itself on success.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  _Mode _mode = _Mode.signIn;
  bool _busy = false;
  bool _obscure = true;
  String? _error;

  /// Set after a rejected email/password sign-in so the legacy-member notice
  /// is emphasised.
  bool _badCredentials = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  bool get _isSignIn => _mode == _Mode.signIn;

  void _switchMode(_Mode mode) => setState(() {
    _mode = mode;
    _error = null;
    _badCredentials = false;
    // Keep the email so a legacy member can go straight to creating a
    // password for the address they subscribed with.
    _password.clear();
  });

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
      _badCredentials = false;
    });
    try {
      if (_isSignIn) {
        await widget.auth.signIn(email: _email.text, password: _password.text);
      } else {
        await widget.auth.createAccount(
          email: _email.text,
          password: _password.text,
        );
      }
      if (mounted) Navigator.of(context).pop();
    } on AuthException catch (e) {
      setState(() {
        _error = e.message;
        _badCredentials = e.badCredentials;
      });
    } on Object {
      setState(() => _error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Sign in with Apple is only wired up natively on Apple platforms.
  /// Android would need Apple's web flow plus a Services ID; see docs.
  bool get _appleAvailable =>
      defaultTargetPlatform == TargetPlatform.iOS ||
      defaultTargetPlatform == TargetPlatform.macOS;

  Future<void> _withProvider(Future<void> Function() signIn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await signIn();
      if (mounted) Navigator.of(context).pop();
    } on AuthException catch (e) {
      if (!e.cancelled) setState(() => _error = e.message);
    } on Object {
      setState(() => _error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resetPassword() async {
    final email = _email.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      setState(() => _error = 'Enter your email above first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.auth.sendPasswordReset(email);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Password reset email sent to $email.')),
      );
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(_isSignIn ? 'Sign in' : 'Create account')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
        child: Form(
          key: _formKey,
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_isSignIn)
                  _LegacyMemberNotice(
                    emphasised: _badCredentials,
                    onCreatePassword: _busy
                        ? null
                        : () => _switchMode(_Mode.createAccount),
                  )
                else
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(
                      'Already subscribed to the newsletter? Use the same '
                      'email and your subscription carries over.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                TextFormField(
                  controller: _email,
                  enabled: !_busy,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  decoration: const InputDecoration(
                    labelText: 'Email',
                    border: OutlineInputBorder(),
                  ),
                  validator: (v) {
                    final value = v?.trim() ?? '';
                    if (value.isEmpty || !value.contains('@')) {
                      return 'Enter a valid email address';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _password,
                  enabled: !_busy,
                  obscureText: _obscure,
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _submit(),
                  autofillHints: [
                    if (_isSignIn)
                      AutofillHints.password
                    else
                      AutofillHints.newPassword,
                  ],
                  decoration: InputDecoration(
                    labelText: 'Password',
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      tooltip: _obscure ? 'Show password' : 'Hide password',
                      icon: Icon(
                        _obscure ? Icons.visibility : Icons.visibility_off,
                      ),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  validator: (v) {
                    if ((v ?? '').length < 6) {
                      return 'Password must be at least 6 characters';
                    }
                    return null;
                  },
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(_isSignIn ? 'Sign in' : 'Create account'),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => _switchMode(
                          _isSignIn ? _Mode.createAccount : _Mode.signIn,
                        ),
                  child: Text(
                    _isSignIn
                        ? 'New here? Create an account'
                        : 'Already have an account? Sign in',
                  ),
                ),
                if (_isSignIn)
                  TextButton(
                    onPressed: _busy ? null : _resetPassword,
                    child: const Text('Forgot password?'),
                  ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    const Expanded(child: Divider()),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text('or', style: theme.textTheme.bodySmall),
                    ),
                    const Expanded(child: Divider()),
                  ],
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  key: const Key('google-sign-in'),
                  onPressed: _busy
                      ? null
                      : () => _withProvider(widget.auth.signInWithGoogle),
                  icon: const Icon(Icons.g_mobiledata, size: 28),
                  label: const Text('Continue with Google'),
                ),
                if (_appleAvailable) ...[
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    key: const Key('apple-sign-in'),
                    onPressed: _busy
                        ? null
                        : () => _withProvider(widget.auth.signInWithApple),
                    style: FilledButton.styleFrom(
                      backgroundColor: theme.colorScheme.onSurface,
                      foregroundColor: theme.colorScheme.surface,
                    ),
                    icon: const Icon(Icons.apple),
                    label: const Text('Continue with Apple'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Tells members who signed up before the app existed that sign-in now uses
/// a password, with a shortcut to create one. Emphasised after a rejected
/// sign-in, which is the moment such a member hits the change.
class _LegacyMemberNotice extends StatelessWidget {
  const _LegacyMemberNotice({
    required this.emphasised,
    required this.onCreatePassword,
  });

  final bool emphasised;
  final VoidCallback? onCreatePassword;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Container(
      key: const Key('legacy-notice'),
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      decoration: BoxDecoration(
        color: emphasised
            ? scheme.primaryContainer
            : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            emphasised
                ? 'Subscribed before we had passwords?'
                : 'Subscribed before?',
            style: theme.textTheme.titleSmall,
          ),
          const SizedBox(height: 4),
          Text(
            'Pizza Predator accounts now use a password. Create one with the '
            'email you subscribed with and your subscription carries over.',
            style: theme.textTheme.bodyMedium,
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: const Key('create-password'),
              onPressed: onCreatePassword,
              child: const Text('Create a password'),
            ),
          ),
        ],
      ),
    );
  }
}
