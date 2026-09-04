import 'package:flutter/material.dart';

import '../account/account_screen.dart';
import '../account/member_service.dart';
import '../app_settings.dart';
import '../auth/auth_service.dart';
import '../auth/sign_in_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.auth, this.members});

  final AuthService auth;
  final MemberService? members;

  static const _appVersion = '0.1.0';

  @override
  Widget build(BuildContext context) {
    final settings = AppSettingsScope.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          const _SectionHeader('Account'),
          _AccountSection(auth: auth, members: members),
          const Divider(),
          const _SectionHeader('Appearance'),
          RadioGroup<ThemeMode>(
            groupValue: settings.themeMode,
            onChanged: (mode) {
              if (mode != null) settings.setThemeMode(mode);
            },
            child: const Column(
              children: [
                RadioListTile<ThemeMode>(
                  title: Text('Match system'),
                  value: ThemeMode.system,
                ),
                RadioListTile<ThemeMode>(
                  title: Text('Light'),
                  value: ThemeMode.light,
                ),
                RadioListTile<ThemeMode>(
                  title: Text('Dark'),
                  value: ThemeMode.dark,
                ),
              ],
            ),
          ),
          const Divider(),
          const _SectionHeader('About'),
          const ListTile(
            leading: Icon(Icons.info_outline),
            title: Text('Pizza Predator'),
            subtitle: Text('Version $_appVersion'),
          ),
        ],
      ),
    );
  }
}

/// Shows "Sign in" when signed out, or the user's email with a sign-out
/// action when signed in.
class _AccountSection extends StatelessWidget {
  const _AccountSection({required this.auth, required this.members});

  final AuthService auth;
  final MemberService? members;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AppUser?>(
      stream: auth.userChanges,
      initialData: auth.currentUser,
      builder: (context, snapshot) {
        final user = snapshot.data;
        if (user == null) {
          return ListTile(
            leading: const Icon(Icons.person_outline),
            title: const Text('Sign in'),
            subtitle: const Text('Sign in or create a Pizza Predator account'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => SignInScreen(auth: auth)),
            ),
          );
        }
        final members = this.members;
        return Column(
          children: [
            ListTile(
              leading: const Icon(Icons.person),
              title: Text(user.displayName ?? user.email ?? 'Signed in'),
              subtitle: Text(
                user.displayName != null && user.email != null
                    ? user.email!
                    : 'Signed in',
              ),
              trailing: TextButton(
                onPressed: auth.signOut,
                child: const Text('Sign out'),
              ),
            ),
            if (members != null && user.emailVerified)
              ListTile(
                key: const Key('manage-account'),
                leading: const Icon(Icons.manage_accounts_outlined),
                title: const Text('Manage account'),
                subtitle: const Text('Name, newsletters and password'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => AccountScreen(auth: auth, members: members),
                  ),
                ),
              )
            else if (members != null)
              _VerifyEmailTile(auth: auth),
          ],
        );
      },
    );
  }
}

/// Shown to password accounts until their email address is verified, which
/// account management requires.
class _VerifyEmailTile extends StatefulWidget {
  const _VerifyEmailTile({required this.auth});

  final AuthService auth;

  @override
  State<_VerifyEmailTile> createState() => _VerifyEmailTileState();
}

class _VerifyEmailTileState extends State<_VerifyEmailTile> {
  bool _sent = false;

  Future<void> _send() async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await widget.auth.sendEmailVerification();
      if (mounted) setState(() => _sent = true);
      messenger.showSnackBar(
        const SnackBar(content: Text('Verification email sent.')),
      );
    } on AuthException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: const Key('verify-email'),
      leading: const Icon(Icons.mark_email_unread_outlined),
      title: const Text('Verify your email'),
      subtitle: Text(
        _sent
            ? 'Check your inbox, then tap here once you have verified'
            : 'Needed before you can manage your account',
      ),
      trailing: TextButton(
        onPressed: _send,
        child: Text(_sent ? 'Resend' : 'Send email'),
      ),
      onTap: widget.auth.reloadUser,
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        text,
        style: theme.textTheme.labelLarge?.copyWith(
          color: theme.colorScheme.primary,
        ),
      ),
    );
  }
}
