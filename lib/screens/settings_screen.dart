import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../account/account_screen.dart';
import '../account/member_service.dart';
import '../app_settings.dart';
import '../auth/auth_service.dart';
import '../auth/sign_in_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.auth, this.members});

  final AuthService auth;
  final MemberService? members;

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
          const _AboutTile(),
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
            subtitle: const Text('Sign in or create a bikes.pizza account'),
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
              title: Text(user.email ?? 'Signed in'),
              subtitle: const Text('Signed in'),
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
                subtitle: const Text('Username, newsletters and password'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => AccountScreen(auth: auth, members: members),
                  ),
                ),
              )
            else if (members != null)
              _VerifyEmailTile(auth: auth, members: members),
          ],
        );
      },
    );
  }
}

/// Shown to password accounts until their email address is verified, which
/// account management requires. Once it is, the username and newsletter
/// choice made at sign-up are sent.
class _VerifyEmailTile extends StatefulWidget {
  const _VerifyEmailTile({required this.auth, required this.members});

  final AuthService auth;
  final MemberService members;

  @override
  State<_VerifyEmailTile> createState() => _VerifyEmailTileState();
}

class _VerifyEmailTileState extends State<_VerifyEmailTile> {
  bool _sent = false;

  Future<void> _check() async {
    await widget.auth.reloadUser();
    final user = widget.auth.currentUser;
    if (user != null && user.emailVerified) {
      await widget.members.applyPending(user.uid);
    }
  }

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
      onTap: _check,
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

/// The app's name and the version it was built with (from pubspec.yaml,
/// via the platform's package info), so this never goes stale.
class _AboutTile extends StatelessWidget {
  const _AboutTile();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PackageInfo>(
      future: PackageInfo.fromPlatform(),
      builder: (context, snapshot) {
        final info = snapshot.data;
        final version = info == null
            ? 'Version …'
            : 'Version ${info.version} (build ${info.buildNumber})';
        return ListTile(
          leading: const Icon(Icons.info_outline),
          title: const Text('bikes.pizza'),
          subtitle: Text(version),
        );
      },
    );
  }
}
