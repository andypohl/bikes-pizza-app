import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_settings.dart';
import '../auth/auth_service.dart';
import '../auth/sign_in_screen.dart';
import '../config.dart';
import '../data/post_repository.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.repository,
    required this.auth,
  });

  final PostRepository repository;
  final AuthService auth;

  static const _appVersion = '0.1.0';

  Future<void> _openSite() =>
      launchUrl(Uri.parse(GhostConfig.siteUrl), mode: LaunchMode.externalApplication);

  @override
  Widget build(BuildContext context) {
    final settings = AppSettingsScope.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          const _SectionHeader('Account'),
          _AccountTile(auth: auth),
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
class _AccountTile extends StatelessWidget {
  const _AccountTile({required this.auth});

  final AuthService auth;

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
              MaterialPageRoute<void>(
                builder: (_) => SignInScreen(auth: auth),
              ),
            ),
          );
        }
        return ListTile(
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
        );
      },
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
