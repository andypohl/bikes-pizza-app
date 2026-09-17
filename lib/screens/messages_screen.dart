import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../auth/auth_service.dart';
import '../messages/message_tracker.dart';
import '../messages/thread_service.dart';
import 'thread_screen.dart';

/// The member's direct message threads, newest message first: the other
/// member's username, the newest message's preview and time, and the
/// unread count in bold. Tapping one opens the [ThreadScreen]. Follows the
/// [MessageTracker], so it updates as messages arrive.
class MessagesScreen extends StatelessWidget {
  const MessagesScreen({
    super.key,
    required this.tracker,
    required this.service,
    required this.auth,
    this.now,
  });

  final MessageTracker tracker;
  final ThreadService service;
  final AuthService auth;
  final DateTime Function()? now;

  static final _dateFormat = DateFormat.MMMd();
  static final _timeFormat = DateFormat.jm();

  /// "3:20 PM" today, "Sep 4" otherwise.
  static String when(DateTime at, DateTime now) {
    final local = at.toLocal();
    final sameDay =
        local.year == now.year &&
        local.month == now.month &&
        local.day == now.day;
    return sameDay ? _timeFormat.format(local) : _dateFormat.format(local);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      body: ListenableBuilder(
        listenable: tracker,
        builder: (context, _) {
          final threads = tracker.threads;
          if (threads.isEmpty) {
            return const _Empty(
              icon: Icons.mail_outline,
              title: 'No messages yet',
              detail:
                  'Open a member\'s profile and tap Message to start a '
                  'conversation.',
            );
          }
          final today = (now ?? DateTime.now)();
          return ListView.separated(
            itemCount: threads.length,
            separatorBuilder: (_, _) => const Divider(height: 1, indent: 72),
            itemBuilder: (context, i) {
              final thread = threads[i];
              final unread = thread.unread > 0;
              final weight = unread ? FontWeight.w600 : FontWeight.normal;
              return ListTile(
                key: Key('thread-${thread.id}'),
                leading: CircleAvatar(
                  child: Text(
                    thread.otherUsername.isEmpty
                        ? '?'
                        : thread.otherUsername[0].toUpperCase(),
                  ),
                ),
                title: Text(
                  thread.otherUsername,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: weight,
                  ),
                ),
                subtitle: Text(
                  thread.blocked
                      ? 'Blocked'
                      : thread.lastText.isEmpty
                      ? 'No messages yet'
                      : thread.lastText,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: weight,
                    color: unread
                        ? theme.colorScheme.onSurface
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (thread.lastAt != null)
                      Text(
                        when(thread.lastAt!, today),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    if (unread)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Badge.count(
                          key: Key('thread-unread-${thread.id}'),
                          count: thread.unread,
                        ),
                      ),
                  ],
                ),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ThreadScreen(
                      thread: thread,
                      service: service,
                      auth: auth,
                      now: now,
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

/// An icon, a title and a line of detail, centered, for an empty list.
class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.title, required this.detail});

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(title, style: theme.textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              detail,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
