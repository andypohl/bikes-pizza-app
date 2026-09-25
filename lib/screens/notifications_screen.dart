import 'package:flutter/material.dart';

import '../account/member_service.dart';
import '../auth/auth_service.dart';
import '../contract.dart';
import '../notifications/notification_settings.dart';
import '../notifications/push_coordinator.dart';

/// The notification switches: the broadcast ones are this device's
/// ([NotificationSettings]); the personal ones are the member's, kept on
/// their record through [members], and only shown when signed in.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({
    super.key,
    required this.notifications,
    required this.coordinator,
    required this.auth,
    this.members,
  });

  final NotificationSettings notifications;
  final PushCoordinator coordinator;
  final AuthService auth;
  final MemberService? members;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool? _granted;
  MemberProfile? _profile;
  String? _error;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    widget.notifications.addListener(_changed);
    _load();
  }

  @override
  void dispose() {
    widget.notifications.removeListener(_changed);
    super.dispose();
  }

  void _changed() => setState(() {});

  Future<void> _load() async {
    final granted = await widget.coordinator.ensurePermission();
    if (mounted) setState(() => _granted = granted);
    final members = widget.members;
    if (members == null || widget.auth.currentUser == null) return;
    try {
      final profile = await members.load();
      if (mounted) setState(() => _profile = profile);
    } on MemberException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _setMember(String category, bool on) async {
    final members = widget.members;
    final profile = _profile;
    if (members == null || profile == null) return;
    setState(() => _saving = true);
    try {
      final updated = await members.update(notifications: {category: on});
      if (mounted) setState(() => _profile = updated);
    } on MemberException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final signedIn = widget.auth.currentUser != null;
    final profile = _profile;
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: ListView(
        key: const Key('notification-settings'),
        children: [
          if (_granted == false)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Text(
                'Notifications are turned off for bikes.pizza in your '
                "device's settings. Turn them on there to receive any of "
                'these.',
                key: const Key('notifications-denied'),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ),
          const _Header('Posts'),
          for (final c in notificationCategories)
            if (c.device)
              SwitchListTile(
                key: Key('notify-${c.value}'),
                title: Text(c.title),
                subtitle: Text(_deviceSubtitle(c.value, c.description)),
                value: widget.notifications.isOn(c.value),
                onChanged: (on) => widget.notifications.setOn(c.value, on),
              ),
          const Divider(),
          const _Header('Activity'),
          if (!signedIn)
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: Text(
                'Sign in from Settings to be told about messages, comments '
                'on your posts, and replies.',
                key: Key('notifications-signed-out'),
              ),
            )
          else if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: Text(_error!, key: const Key('notifications-error')),
            )
          else if (profile == null)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            )
          else
            for (final c in notificationCategories)
              if (!c.device)
                SwitchListTile(
                  key: Key('notify-${c.value}'),
                  title: Text(c.title),
                  subtitle: Text(c.description),
                  value: profile.notifications[c.value] ?? c.on,
                  onChanged: _saving ? null : (on) => _setMember(c.value, on),
                ),
        ],
      ),
    );
  }

  /// The broadcast switches follow the "Show me" choice; say so.
  String _deviceSubtitle(String category, String description) =>
      '$description. Only for the feeds you show.';
}

class _Header extends StatelessWidget {
  const _Header(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
    child: Text(text, style: Theme.of(context).textTheme.titleSmall),
  );
}
