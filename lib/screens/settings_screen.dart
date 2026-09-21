import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../account/account_screen.dart';
import '../account/data_export.dart';
import '../account/member_service.dart';
import '../data/post_repository.dart';
import '../messages/message_tracker.dart';
import '../messages/thread_service.dart';
import '../posts/comment_service.dart';
import '../posts/profile_service.dart';
import '../posts/reaction_service.dart';
import 'blocked_members_screen.dart';
import 'profile_screen.dart';
import '../app_settings.dart';
import '../auth/auth_service.dart';
import '../auth/passkey_service.dart';
import '../auth/session_expiry.dart';
import '../auth/sign_in_screen.dart';
import '../config.dart';
import '../posts/post_editor.dart';
import '../submissions/photo_picker.dart';
import 'my_posts_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.auth,
    this.members,
    this.passkeys,
    this.editor,
    this.photos,
    this.exporter,
    this.profiles,
    this.repository,
    this.reactions,
    this.comments,
    this.threads,
    this.messages,
  });

  final AuthService auth;
  final MemberService? members;

  /// Null when this build cannot use passkeys; the screens then omit them.
  final PasskeyService? passkeys;

  /// Both needed for the Posts tile (editing published posts); null
  /// hides it.
  final PostEditor? editor;
  final PhotoPicker? photos;

  /// Offers "Export my data" on the account screen; null leaves it out.
  final DataExporter? exporter;

  /// With [repository], offers "Your profile" (what other members see).
  final ProfileService? profiles;
  final PostRepository? repository;
  final ReactionService? reactions;
  final CommentService? comments;

  /// Offers "Blocked members" and lets the member's own profile message.
  final ThreadService? threads;
  final MessageTracker? messages;

  @override
  Widget build(BuildContext context) {
    final settings = AppSettingsScope.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          const _SectionHeader('Account'),
          _AccountSection(
            auth: auth,
            members: members,
            passkeys: passkeys,
            editor: editor,
            photos: photos,
            exporter: exporter,
            profiles: profiles,
            repository: repository,
            reactions: reactions,
            comments: comments,
            threads: threads,
          ),
          const Divider(),
          const _SectionHeader('Show me'),
          _ShowMeChoice(
            choice: settings.feedChoice,
            onChanged: settings.setFeedChoice,
          ),
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
          const _PrivacyTile(),
          const _TermsTile(),
          const _ContactTile(),
          _DeleteAccountSection(auth: auth, members: members),
        ],
      ),
    );
  }
}

/// Shows "Sign in" when signed out, or the user's email with a sign-out
/// action when signed in.
class _AccountSection extends StatelessWidget {
  const _AccountSection({
    required this.auth,
    required this.members,
    required this.passkeys,
    required this.editor,
    required this.photos,
    this.exporter,
    this.profiles,
    this.repository,
    this.reactions,
    this.comments,
    this.threads,
  });

  final AuthService auth;
  final MemberService? members;
  final PasskeyService? passkeys;
  final PostEditor? editor;
  final PhotoPicker? photos;
  final DataExporter? exporter;
  final ProfileService? profiles;
  final PostRepository? repository;
  final ReactionService? reactions;
  final CommentService? comments;
  final ThreadService? threads;

  /// Opens the member's own profile, once their username is known.
  Future<void> _openOwnProfile(BuildContext context) async {
    final members = this.members;
    final profiles = this.profiles;
    final repository = this.repository;
    if (members == null || profiles == null || repository == null) return;
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      final profile = await members.load();
      if (profile.username.isEmpty) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text('Choose a username in Manage account first.'),
          ),
        );
        return;
      }
      await navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => ProfileScreen(
            username: profile.username,
            profiles: profiles,
            repository: repository,
            auth: auth,
            reactions: reactions,
            comments: comments,
            threads: threads,
          ),
        ),
      );
    } on MemberException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

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
              MaterialPageRoute<void>(
                builder: (_) => SignInScreen(auth: auth, passkeys: passkeys),
              ),
            ),
          );
        }
        final members = this.members;
        final editor = this.editor;
        final photos = this.photos;
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
            if (editor != null && photos != null && user.emailVerified)
              ListTile(
                key: const Key('my-posts'),
                leading: const Icon(Icons.edit_note_outlined),
                title: const Text('Posts'),
                subtitle: const Text('Edit the bikes and pizzas you posted'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => MyPostsScreen(
                      editor: editor,
                      photos: photos,
                      auth: auth,
                    ),
                  ),
                ),
              ),
            if (members != null &&
                profiles != null &&
                repository != null &&
                user.emailVerified)
              ListTile(
                key: const Key('your-profile'),
                leading: const Icon(Icons.badge_outlined),
                title: const Text('Your profile'),
                subtitle: const Text('What other members see'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _openOwnProfile(context),
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
                    builder: (_) => AccountScreen(
                      auth: auth,
                      members: members,
                      passkeys: passkeys,
                      exporter: exporter,
                    ),
                  ),
                ),
              )
            else if (members != null)
              _VerifyEmailTile(auth: auth, members: members),
            if (threads case final threads? when user.emailVerified)
              ListTile(
                key: const Key('blocked-members'),
                leading: const Icon(Icons.block_outlined),
                title: const Text('Blocked members'),
                subtitle: const Text('Members you have blocked'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        BlockedMembersScreen(service: threads, auth: auth),
                  ),
                ),
              ),
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

/// The last thing on the screen: "Delete account" for a signed-in member,
/// kept well away from the everyday account actions. Nothing when signed
/// out or when account management is unavailable.
class _DeleteAccountSection extends StatelessWidget {
  const _DeleteAccountSection({required this.auth, required this.members});

  final AuthService auth;
  final MemberService? members;

  @override
  Widget build(BuildContext context) {
    final members = this.members;
    if (members == null) return const SizedBox.shrink();
    return StreamBuilder<AppUser?>(
      stream: auth.userChanges,
      initialData: auth.currentUser,
      builder: (context, snapshot) {
        if (snapshot.data == null) return const SizedBox.shrink();
        return Column(
          children: [
            const Divider(),
            _DeleteAccountTile(auth: auth, members: members),
          ],
        );
      },
    );
  }
}

/// Deletes the account after an "Are you sure?". Offered to every signed-in
/// member, verified or not: an account that never verified its email must
/// still be able to remove itself.
class _DeleteAccountTile extends StatefulWidget {
  const _DeleteAccountTile({required this.auth, required this.members});

  final AuthService auth;
  final MemberService members;

  @override
  State<_DeleteAccountTile> createState() => _DeleteAccountTileState();
}

class _DeleteAccountTileState extends State<_DeleteAccountTile> {
  bool _busy = false;

  Future<void> _confirm() async {
    final messenger = ScaffoldMessenger.of(context);
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete your account?'),
        content: const Text(
          'Your sign-in and profile (username and newsletter choices) are '
          "removed for good. Posts you've published stay, credited as they "
          'are.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('confirm-delete-account'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.members.deleteAccount();
      await widget.auth.signOut();
      messenger.showSnackBar(
        const SnackBar(content: Text('Your account has been deleted.')),
      );
    } on MemberException catch (e) {
      if (e.sessionExpired && mounted) {
        return handleSessionExpired(context, widget.auth);
      }
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final error = Theme.of(context).colorScheme.error;
    return ListTile(
      key: const Key('delete-account'),
      leading: Icon(Icons.delete_forever_outlined, color: error),
      title: Text('Delete account', style: TextStyle(color: error)),
      subtitle: const Text('Removes your sign-in and profile for good'),
      enabled: !_busy,
      onTap: _confirm,
    );
  }
}

/// The "Show me" choice: bikes only on the left, both in the middle,
/// pizza only on the right. Leaving a feed out hides its tab.
class _ShowMeChoice extends StatelessWidget {
  const _ShowMeChoice({required this.choice, required this.onChanged});

  final FeedChoice choice;
  final ValueChanged<FeedChoice> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      child: SegmentedButton<FeedChoice>(
        key: const Key('show-me'),
        segments: [
          for (final option in FeedChoice.values)
            ButtonSegment(value: option, label: Text(option.label)),
        ],
        selected: {choice},
        showSelectedIcon: false,
        onSelectionChanged: (picked) => onChanged(picked.single),
      ),
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
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(version),
              Text('© ${DateTime.now().year} Pizza Predator, LLC'),
            ],
          ),
          isThreeLine: true,
        );
      },
    );
  }
}

/// Opens the website's privacy policy. Debug and profile builds point at
/// bikes-pizza.dev and release builds at bikes.pizza, like the rest of the app.
class _PrivacyTile extends StatelessWidget {
  const _PrivacyTile();

  Future<bool> _open() {
    final uri = Uri.parse('${SiteConfig.siteUrl}/privacy');
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: const Key('privacy-policy'),
      leading: const Icon(Icons.privacy_tip_outlined),
      title: const Text('Privacy policy'),
      subtitle: const Text('What we collect and how to delete your account'),
      trailing: const Icon(Icons.open_in_new),
      onTap: _open,
    );
  }
}

/// Opens the website's terms of use, on the same site as the privacy policy.
class _TermsTile extends StatelessWidget {
  const _TermsTile();

  Future<bool> _open() {
    final uri = Uri.parse('${SiteConfig.siteUrl}/terms');
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: const Key('terms-of-use'),
      leading: const Icon(Icons.gavel_outlined),
      title: const Text('Terms of use'),
      subtitle: const Text('The rules for posts, comments and messages'),
      trailing: const Icon(Icons.open_in_new),
      onTap: _open,
    );
  }
}

/// Opens a mail composer for general questions and comments.
class _ContactTile extends StatelessWidget {
  const _ContactTile();

  static const String address = 'contact@bikes.pizza';

  Future<bool> _open() {
    final uri = Uri(scheme: 'mailto', path: address);
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: const Key('contact-us'),
      leading: const Icon(Icons.mail_outline),
      title: const Text('Contact us'),
      subtitle: const Text(address),
      trailing: const Icon(Icons.open_in_new),
      onTap: _open,
    );
  }
}
