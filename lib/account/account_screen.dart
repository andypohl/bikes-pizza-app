import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import 'member_service.dart';

/// Lets a signed-in member edit their name and newsletters, change their
/// password (password accounts only), and sign out.
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
  final _name = TextEditingController();
  final _selected = <String>{};
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _profile = null;
      _error = null;
    });
    try {
      final profile = await widget.members.load();
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
    _name.text = profile.name;
    _selected
      ..clear()
      ..addAll([
        for (final n in profile.newsletters)
          if (n.subscribed) n.id,
      ]);
  }

  Future<void> _save() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _saving = true);
    try {
      final profile = await widget.members.update(
        name: _name.text,
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
          TextField(
            key: const Key('name'),
            controller: _name,
            autocorrect: false,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Name'),
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
