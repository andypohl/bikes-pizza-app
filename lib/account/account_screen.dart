import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import 'member_service.dart';
import 'totp_setup_screen.dart';

/// Lets a signed-in member edit their username and newsletters, change
/// their password (password accounts only), turn two-factor authentication
/// on or off, and sign out. A member without
/// a username yet (a new account, or one from before usernames) is asked
/// to choose one here.
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key, required this.auth, required this.members});

  final AuthService auth;
  final MemberService members;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  MemberProfile? _profile;
  String? _error;
  final _formKey = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _selected = <String>{};
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _username.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _profile = null;
      _error = null;
    });
    try {
      final user = widget.auth.currentUser;
      // Choices saved at sign-up are sent before the profile is shown.
      final profile =
          (user == null ? null : await widget.members.applyPending(user.uid)) ??
          await widget.members.load();
      if (!mounted) return;
      setState(() => _apply(profile));
    } on MemberException catch (e) {
      if (!mounted) return;
      if (e.sessionExpired) return handleSessionExpired(context, widget.auth);
      setState(() => _error = e.message);
    }
  }

  void _apply(MemberProfile profile) {
    _profile = profile;
    _username.text = profile.username;
    _selected
      ..clear()
      ..addAll([
        for (final n in profile.newsletters)
          if (n.subscribed) n.id,
      ]);
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _saving = true);
    try {
      final profile = await widget.members.update(
        username: _username.text.trim(),
        newsletters: _selected.toList(),
      );
      if (!mounted) return;
      setState(() => _apply(profile));
      messenger.showSnackBar(const SnackBar(content: Text('Saved.')));
    } on MemberException catch (e) {
      if (e.sessionExpired && mounted) {
        return handleSessionExpired(context, widget.auth);
      }
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _signOut() async {
    final navigator = Navigator.of(context);
    await widget.auth.signOut();
    if (navigator.mounted) navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.auth.currentUser;
    final profile = _profile;
    final error = _error;

    final Widget body;
    if (user == null) {
      body = const Center(child: Text('Sign in first.'));
    } else if (error != null) {
      body = Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(error),
            const SizedBox(height: 12),
            FilledButton(onPressed: _load, child: const Text('Try again')),
          ],
        ),
      );
    } else if (profile == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      body = ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.person),
            title: Text(profile.email),
            subtitle: Text(_signInMethods(user)),
          ),
          const _Heading('Profile'),
          if (profile.username.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                'Choose a username. It is shown when you are credited for '
                'a post.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
          Form(
            key: _formKey,
            child: TextFormField(
              key: const Key('username'),
              controller: _username,
              autocorrect: false,
              enableSuggestions: false,
              autofillHints: const [AutofillHints.username],
              maxLength: 24,
              decoration: const InputDecoration(
                labelText: 'Username',
                helperText: usernameRule,
              ),
              validator: validateUsername,
            ),
          ),
          if (profile.newsletters.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final n in profile.newsletters)
              SwitchListTile(
                key: Key('newsletter-${n.id}'),
                contentPadding: EdgeInsets.zero,
                title: Text(n.name),
                subtitle: n.description.isEmpty ? null : Text(n.description),
                value: _selected.contains(n.id),
                onChanged: _saving
                    ? null
                    : (on) => setState(() {
                        if (on) {
                          _selected.add(n.id);
                        } else {
                          _selected.remove(n.id);
                        }
                      }),
              ),
          ],
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('save-profile'),
            onPressed: _saving ? null : _save,
            child: const Text('Save changes'),
          ),
          const _Heading('Password'),
          if (user.hasPassword)
            _PasswordSection(auth: widget.auth, email: user.email)
          else
            Text(
              'You sign in with ${_providerNames(user).join(' and ')}, so '
              "there's no password to manage here.",
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          const _Heading('Two-factor authentication'),
          _SecondFactorSection(auth: widget.auth),
          const SizedBox(height: 24),
          TextButton(
            key: const Key('sign-out'),
            onPressed: _signOut,
            child: const Text('Sign out'),
          ),
        ],
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: body,
    );
  }

  static const _methodNames = {
    'password': 'a password',
    'google.com': 'Google',
    'apple.com': 'Apple',
  };

  static List<String> _providerNames(AppUser user) => [
    for (final id in user.providerIds) _methodNames[id] ?? id,
  ];

  static String _signInMethods(AppUser user) {
    final names = _providerNames(user);
    return names.isEmpty ? 'Signed in' : 'Signs in with ${names.join(' and ')}';
  }
}

class _PasswordSection extends StatefulWidget {
  const _PasswordSection({required this.auth, required this.email});

  final AuthService auth;
  final String? email;

  @override
  State<_PasswordSection> createState() => _PasswordSectionState();
}

class _PasswordSectionState extends State<_PasswordSection> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _change() async {
    final messenger = ScaffoldMessenger.of(context);
    final current = _current.text;
    final next = _next.text;
    if (current.isEmpty || next.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Enter your current password and a new one.'),
        ),
      );
      return;
    }
    if (next.length < 6) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('New password must be at least 6 characters.'),
        ),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.auth.changePassword(current: current, next: next);
      _current.clear();
      _next.clear();
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Password changed. Other devices will need to sign in again.',
          ),
        ),
      );
    } on AuthException catch (e) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            e.badCredentials ? 'Current password is incorrect.' : e.message,
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reset() async {
    final messenger = ScaffoldMessenger.of(context);
    final email = widget.email;
    if (email == null) return;
    try {
      await widget.auth.sendPasswordReset(email);
      messenger.showSnackBar(
        SnackBar(content: Text('Password reset email sent to $email.')),
      );
    } on AuthException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          key: const Key('current-password'),
          controller: _current,
          obscureText: true,
          autocorrect: false,
          enableSuggestions: false,
          decoration: const InputDecoration(labelText: 'Current password'),
        ),
        const SizedBox(height: 8),
        TextField(
          key: const Key('new-password'),
          controller: _next,
          obscureText: true,
          autocorrect: false,
          enableSuggestions: false,
          decoration: const InputDecoration(labelText: 'New password'),
        ),
        const SizedBox(height: 12),
        OutlinedButton(
          key: const Key('change-password'),
          onPressed: _busy ? null : _change,
          child: const Text('Change password'),
        ),
        TextButton(
          key: const Key('reset-password'),
          onPressed: _busy ? null : _reset,
          child: const Text('Forgotten it? Email me a reset link'),
        ),
      ],
    );
  }
}

/// Two-factor authentication: off by default; a switch that walks through
/// enrolling an authenticator app, or removes it again.
class _SecondFactorSection extends StatefulWidget {
  const _SecondFactorSection({required this.auth});

  final AuthService auth;

  @override
  State<_SecondFactorSection> createState() => _SecondFactorSectionState();
}

class _SecondFactorSectionState extends State<_SecondFactorSection> {
  List<SecondFactor>? _factors;
  bool _admin = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final factors = await widget.auth.enrolledFactors();
    final admin = await widget.auth.isAdmin();
    if (mounted) {
      setState(() {
        _factors = factors;
        _admin = admin;
      });
    }
  }

  Future<void> _turnOn() async {
    final enrolled = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => TotpSetupScreen(auth: widget.auth)),
    );
    if (!mounted) return;
    if (enrolled == true) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            "Two-factor authentication is on. You'll be asked for a code "
            'next time you sign in.',
          ),
        ),
      );
    }
    await _load();
  }

  Future<void> _turnOff(SecondFactor factor) async {
    final messenger = ScaffoldMessenger.of(context);
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Turn off two-factor authentication?'),
        content: const Text(
          'Signing in will only need your password or provider again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep it on'),
          ),
          FilledButton(
            key: const Key('confirm-turn-off'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Turn off'),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.auth.removeSecondFactor(factor);
      messenger.showSnackBar(
        const SnackBar(content: Text('Two-factor authentication is off.')),
      );
      await _load();
    } on AuthException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final factors = _factors;
    if (factors == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: LinearProgressIndicator(),
      );
    }
    final on = factors.isNotEmpty;
    // The admin and submissions pages insist on a second factor, so an
    // administrator can turn it on here but not off.
    final locked = on && _admin;
    return SwitchListTile(
      key: const Key('second-factor'),
      contentPadding: EdgeInsets.zero,
      title: const Text('Authenticator app'),
      subtitle: Text(
        locked
            ? 'On, and required for administrators.'
            : on
            ? "On. You're asked for a code from your authenticator app when "
                  'you sign in.'
            : 'Off. Add a second step at sign-in: a code from an '
                  'authenticator app on your phone.',
      ),
      value: on,
      onChanged: _busy || locked
          ? null
          : (next) {
              if (next) {
                _turnOn();
              } else {
                _turnOff(factors.first);
              }
            },
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 24, bottom: 8),
      child: Text(
        text,
        style: theme.textTheme.titleMedium?.copyWith(
          color: theme.colorScheme.primary,
        ),
      ),
    );
  }
}
