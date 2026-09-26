import 'package:flutter/material.dart';

import '../account/member_service.dart';
import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../widgets/layout.dart';
import '../widgets/post_article.dart';
import '../widgets/status_message.dart';
import 'admin_screens.dart';
import 'admin_service.dart';

/// User administration, as https://admin.bikes.pizza/ does it, for
/// administrators: every account ordered by most recent post,
/// and for one account its details, editable username, email and
/// newsletters, a password reset, and deletion. On a landscape tablet the
/// account opens beside the list; otherwise on its own screen.
class UsersScreen extends StatefulWidget {
  const UsersScreen({
    super.key,
    required this.admin,
    required this.auth,
    this.pageSize = 25,
  });

  final AdminService admin;
  final AuthService auth;
  final int pageSize;

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  UserPage? _page;
  ApiException? _error;
  bool _busy = false;
  int _number = 1;
  String? _selectedUid;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final page = await widget.admin.users(
        page: _number,
        pageSize: widget.pageSize,
      );
      if (!mounted) return;
      setState(() {
        _page = page;
        _number = page.page;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.sessionExpired) return handleSessionExpired(context, widget.auth);
      setState(() {
        _page = null;
        _error = e;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _go(int number) {
    setState(() {
      _number = number;
      _selectedUid = null;
    });
    _load();
  }

  void _open(AdminUser user) {
    if (isLandscapeTablet(context)) {
      setState(() => _selectedUid = user.uid);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          appBar: AppBar(title: Text(user.name)),
          body: UserDetail(
            uid: user.uid,
            admin: widget.admin,
            auth: widget.auth,
            onChanged: _load,
            onDeleted: (message) {
              Navigator.of(context).pop();
              _deleted(message);
            },
          ),
        ),
      ),
    );
  }

  void _deleted(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
    setState(() => _selectedUid = null);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final split = isLandscapeTablet(context);
    final selected = _selectedUid;
    final list = _buildList(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Users'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _busy ? null : _load,
          ),
        ],
      ),
      body: split
          ? Row(
              children: [
                Expanded(child: list),
                const VerticalDivider(width: 1, thickness: 1),
                Expanded(
                  child: selected == null
                      ? const NothingSelected(
                          'Choose a user to see their account here.',
                        )
                      : Column(
                          key: ValueKey(selected),
                          children: [
                            Padding(
                              padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: [
                                  IconButton(
                                    key: const Key('close-user'),
                                    tooltip: 'Close',
                                    icon: const Icon(Icons.close),
                                    onPressed: () =>
                                        setState(() => _selectedUid = null),
                                  ),
                                ],
                              ),
                            ),
                            Expanded(
                              child: UserDetail(
                                uid: selected,
                                admin: widget.admin,
                                auth: widget.auth,
                                onChanged: _load,
                                onDeleted: _deleted,
                              ),
                            ),
                          ],
                        ),
                ),
              ],
            )
          : list,
    );
  }

  Widget _buildList(BuildContext context) {
    final theme = Theme.of(context);
    final page = _page;
    final error = _error;
    final split = isLandscapeTablet(context);

    final Widget body;
    if (error != null) {
      body = AdminError(error: error, onRetry: _load);
    } else if (page == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (page.users.isEmpty) {
      body = StatusMessage(
        icon: Icons.people_outline,
        title: 'No users',
        detail: 'Nobody has signed up yet.',
        actionLabel: 'Refresh',
        onAction: _load,
      );
    } else {
      body = ListView.separated(
        itemCount: page.users.length,
        separatorBuilder: (_, _) => const Divider(height: 1, indent: 16),
        itemBuilder: (context, index) {
          final u = page.users[index];
          final latest = u.latestPost;
          return ListTile(
            key: Key('user-${u.uid}'),
            selected: split && u.uid == _selectedUid,
            selectedTileColor: theme.colorScheme.secondaryContainer,
            leading: Icon(
              u.subscribed
                  ? Icons.mark_email_read_outlined
                  : Icons.person_outline,
            ),
            title: Text(u.name),
            subtitle: Text(
              '${u.subscribed ? 'Subscribed' : 'Not subscribed'} · '
              '${u.postCount} post${u.postCount == 1 ? '' : 's'}'
              '${latest == null ? '' : ' · latest: ${latest.title} (${day(latest.publishedAt)})'}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _open(u),
          );
        },
      );
    }

    return Column(
      children: [
        if (page != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '${page.total} user${page.total == 1 ? '' : 's'}, most recent post first.',
                key: const Key('users-summary'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ),
        Expanded(child: body),
        Pager(
          label: page == null || page.total == 0
              ? ''
              : 'Page ${page.page} of ${page.pages}',
          onPrevious: page != null && page.page > 1 && !_busy
              ? () => _go(page.page - 1)
              : null,
          onNext: page != null && page.page < page.pages && !_busy
              ? () => _go(page.page + 1)
              : null,
        ),
      ],
    );
  }
}

/// One account: the details, the editable username, email, admin switch
/// and newsletters (Save enabled once something differs), a password reset
/// for password accounts, and Delete behind an "Are you sure?". The admin
/// switch is read-only on the signed-in admin's own account: nobody may
/// take away their own access.
class UserDetail extends StatefulWidget {
  const UserDetail({
    super.key,
    required this.uid,
    required this.admin,
    required this.auth,
    required this.onChanged,
    required this.onDeleted,
  });

  final String uid;
  final AdminService admin;
  final AuthService auth;

  /// Called after a save, so the list can catch up.
  final VoidCallback onChanged;

  /// Called with a message after the account is deleted.
  final ValueChanged<String> onDeleted;

  @override
  State<UserDetail> createState() => _UserDetailState();
}

class _UserDetailState extends State<UserDetail> {
  final _formKey = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _email = TextEditingController();
  final _selected = <String>{};
  bool _admin = false;
  AdminUser? _user;
  ApiException? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _username.addListener(_changed);
    _email.addListener(_changed);
    _load();
  }

  @override
  void dispose() {
    _username.dispose();
    _email.dispose();
    super.dispose();
  }

  void _changed() => setState(() {});

  Future<void> _load() async {
    setState(() {
      _user = null;
      _error = null;
    });
    try {
      final user = await widget.admin.user(widget.uid);
      if (!mounted) return;
      setState(() => _apply(user));
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.sessionExpired) return handleSessionExpired(context, widget.auth);
      setState(() => _error = e);
    }
  }

  void _apply(AdminUser user) {
    _user = user;
    _username.text = user.username;
    _email.text = user.email;
    _admin = user.admin;
    _selected
      ..clear()
      ..addAll([
        for (final n in user.newsletters)
          if (n.subscribed) n.id,
      ]);
  }

  /// What differs from the loaded account; all null when nothing does.
  ({String? username, String? email, List<String>? newsletters, bool? admin})
  _changes() {
    final user = _user!;
    final username = _username.text.trim();
    final email = _email.text.trim();
    final before = [
      for (final n in user.newsletters)
        if (n.subscribed) n.id,
    ]..sort();
    final now = _selected.toList()..sort();
    return (
      username: username != user.username ? username : null,
      email: email != user.email ? email : null,
      newsletters: before.join(',') != now.join(',') ? now : null,
      admin: _admin != user.admin ? _admin : null,
    );
  }

  bool get _dirty {
    if (_user == null) return false;
    final c = _changes();
    return c.username != null ||
        c.email != null ||
        c.newsletters != null ||
        c.admin != null;
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final changes = _changes();
    setState(() => _busy = true);
    final updated = await guardAdmin(
      context,
      widget.auth,
      () => widget.admin.updateUser(
        widget.uid,
        username: changes.username,
        email: changes.email,
        newsletters: changes.newsletters,
        admin: changes.admin,
      ),
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (updated != null) _apply(updated);
    });
    if (updated != null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Saved.')));
      widget.onChanged();
    }
  }

  Future<void> _resetPassword() async {
    final email = _user?.email;
    if (email == null || email.isEmpty) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await widget.auth.sendPasswordReset(email);
      messenger.showSnackBar(
        SnackBar(content: Text('Password reset email sent to $email.')),
      );
    } on AuthException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final user = _user;
    if (user == null) return;
    final sure = await confirmDanger(
      context,
      title: 'Delete ${user.name}?',
      message: 'Their account and profile go; their posts stay as they are.',
      confirmLabel: 'Delete',
      confirmKey: const Key('confirm-delete-user'),
    );
    if (!sure || !mounted) return;
    setState(() => _busy = true);
    final ok = await guardAdmin(context, widget.auth, () async {
      await widget.admin.deleteUser(user.uid);
      return true;
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok == true) widget.onDeleted('Deleted ${user.name}.');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = _user;
    final isSelf = widget.auth.currentUser?.uid == widget.uid;
    final error = _error;
    if (error != null) return AdminError(error: error, onRetry: _load);
    if (user == null) return const Center(child: CircularProgressIndicator());

    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(user.name, style: theme.textTheme.headlineSmall),
          const SizedBox(height: 4),
          Text(
            '${user.postCount} post${user.postCount == 1 ? '' : 's'} · uid ${user.uid}',
            style: muted,
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const Key('user-username'),
            controller: _username,
            enabled: !_busy,
            autocorrect: false,
            enableSuggestions: false,
            maxLength: 24,
            decoration: const InputDecoration(
              labelText: 'Username',
              helperText: usernameRule,
              counterText: '',
            ),
            validator: (v) =>
                (v ?? '').trim().isEmpty ? null : validateUsername(v),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('user-email'),
            controller: _email,
            enabled: !_busy,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'Email'),
            validator: (v) => (v ?? '').trim().contains('@')
                ? null
                : "That email address doesn't look right.",
          ),
          const SizedBox(height: 12),
          DetailRow(
            'Signs in with',
            user.providers.isEmpty ? 'unknown' : user.providers.join(' and '),
          ),
          DetailRow('Verified', user.emailVerified ? 'Yes' : 'No'),
          DetailRow(
            'Joined',
            when(user.createdAt).isEmpty ? 'unknown' : when(user.createdAt),
          ),
          DetailRow(
            'Last sign-in',
            when(user.lastSignInAt).isEmpty ? 'never' : when(user.lastSignInAt),
          ),
          const SizedBox(height: 8),
          SwitchListTile(
            key: const Key('user-admin'),
            contentPadding: EdgeInsets.zero,
            title: const Text('Admin'),
            subtitle: Text(
              isSelf
                  ? "You can't change your own admin access."
                  : 'Can open the admin screens and pages; they also need a '
                        'passkey sign-in.',
            ),
            value: _admin,
            onChanged: _busy || isSelf
                ? null
                : (on) => setState(() => _admin = on),
          ),
          if (user.newsletters.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final n in user.newsletters)
              CheckboxListTile(
                key: Key('user-newsletter-${n.id}'),
                contentPadding: EdgeInsets.zero,
                title: Text(n.name),
                subtitle: n.description.isEmpty ? null : Text(n.description),
                value: _selected.contains(n.id),
                onChanged: _busy
                    ? null
                    : (on) => setState(() {
                        if (on ?? false) {
                          _selected.add(n.id);
                        } else {
                          _selected.remove(n.id);
                        }
                      }),
              ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton(
                key: const Key('user-save'),
                onPressed: _busy || !_dirty ? null : _save,
                child: const Text('Save'),
              ),
              if (user.hasPassword)
                OutlinedButton(
                  key: const Key('user-reset-password'),
                  onPressed: _busy ? null : _resetPassword,
                  child: const Text('Reset password'),
                ),
              OutlinedButton(
                key: const Key('user-delete'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.colorScheme.error,
                ),
                onPressed: _busy ? null : _delete,
                child: const Text('Delete user'),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Text(
            user.posts.isEmpty ? 'No posts yet.' : 'Posts, newest first:',
            style: theme.textTheme.titleSmall,
          ),
          for (final p in user.posts)
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text(p.title),
              subtitle: Text(day(p.publishedAt)),
              trailing: p.url == null ? null : const Icon(Icons.open_in_new),
              onTap: p.url == null ? null : () => PostArticle.open(p.url!),
            ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}
