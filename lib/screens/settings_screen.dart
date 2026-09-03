import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_settings.dart';
import '../auth/auth_service.dart';
import '../auth/sign_in_screen.dart';
import '../config.dart';
import '../data/post_repository.dart';
import '../ghost/ghost_session_service.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.repository,
    required this.auth,
    this.ghost,
  });

  final PostRepository repository;
  final AuthService auth;
  final GhostSessionService? ghost;

  static const _appVersion = '0.1.0';

  Future<void> _openSite() => launchUrl(
    Uri.parse(GhostConfig.siteUrl),
    mode: LaunchMode.externalApplication,
  );

  @override
  Widget build(BuildContext context) {
    final settings = AppSettingsScope.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          const _SectionHeader('Account'),
          _AccountSection(auth: auth, ghost: ghost),
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
          const _SectionHeader('Content'),
          ListTile(
            leading: const Icon(Icons.cloud_outlined),
            title: const Text('Data source'),
            subtitle: Text(
              GhostConfig.hasContentApiKey
                  ? repository.sourceName
                  : '${repository.sourceName}\n'
                        'Build with --dart-define=GHOST_CONTENT_API_KEY=... '
                        'to load the full archive.',
            ),
            isThreeLine: !GhostConfig.hasContentApiKey,
          ),
          ListTile(
            leading: const Icon(Icons.public),
            title: const Text('Visit pizzapredator.com'),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: _openSite,
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
  const _AccountSection({required this.auth, required this.ghost});

  final AuthService auth;
  final GhostSessionService? ghost;

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
        final ghost = this.ghost;
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
            if (ghost != null && user.emailVerified)
              _MemberSiteTile(ghost: ghost)
            else if (ghost != null)
              _VerifyEmailTile(auth: auth),
          ],
        );
      },
    );
  }
}

/// Signs the user in on the website (as a Ghost member) and opens it.
class _MemberSiteTile extends StatefulWidget {
  const _MemberSiteTile({required this.ghost});

  final GhostSessionService ghost;

  @override
  State<_MemberSiteTile> createState() => _MemberSiteTileState();
}

class _MemberSiteTileState extends State<_MemberSiteTile> {
  bool _busy = false;

  Future<void> _open() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final url = await widget.ghost.signInUrl();
      await launchUrl(url, mode: LaunchMode.inAppBrowserView);
    } on GhostSessionException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: const Key('member-site'),
      leading: const Icon(Icons.badge_outlined),
      title: const Text('Open pizzapredator.com as a member'),
      subtitle: const Text(
        'Signs you in on the website without a magic-link email',
      ),
      trailing: _busy
          ? const SizedBox.square(
              dimension: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.open_in_new),
      enabled: !_busy,
      onTap: _open,
    );
  }
}

/// Shown to password accounts until their email address is verified, which
/// the website sign-in requires.
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
            : 'Needed before you can sign in on the website',
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
