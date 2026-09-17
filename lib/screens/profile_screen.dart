import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../contract.dart';
import '../data/post_repository.dart';
import '../auth/session_expiry.dart';
import '../messages/thread_service.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import '../posts/comment_service.dart';
import '../posts/profile_service.dart';
import '../posts/reaction_service.dart';
import '../widgets/status_message.dart';
import 'post_list_screen.dart';
import 'thread_screen.dart';

/// A member's profile, reached by tapping their username: when they
/// joined, the location they chose to share, and how many pizzas and
/// bikes they have posted, each opening the list of those posts (a
/// [PostListScreen] filtered to the member and feed).
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    required this.username,
    required this.profiles,
    required this.repository,
    this.auth,
    this.reactions,
    this.comments,
    this.threads,
  });

  final String username;
  final ProfileService profiles;
  final PostRepository repository;
  final AuthService? auth;
  final ReactionService? reactions;
  final CommentService? comments;

  /// With [auth], offers Message when the member takes them.
  final ThreadService? threads;

  static final _dateFormat = DateFormat.yMMMMd();

  /// "3 pizzas", "1 bike": the count with the feed's noun.
  static String countLabel(String feed, int count) {
    final noun = feedNouns[feed] ?? feed;
    return '$count ${count == 1 ? noun : '${noun}s'}';
  }

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  PublicProfile? _profile;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _profile = null;
      _error = null;
    });
    try {
      final profile = await widget.profiles.fetch(widget.username);
      if (mounted) setState(() => _profile = profile);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _message(PublicProfile profile) async {
    final threads = widget.threads;
    final auth = widget.auth;
    if (threads == null || auth == null) return;
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      final thread = await threads.open(profile.username);
      if (!mounted) return;
      await navigator.push(
        MaterialPageRoute<void>(
          builder: (_) =>
              ThreadScreen(thread: thread, service: threads, auth: auth),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.sessionExpired) return handleSessionExpired(context, auth);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  void _openPosts(PublicProfile profile, PostFeed feed) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PostListScreen(
          feed: feed,
          repository: widget.repository,
          credit: PostCredit(uid: profile.uid, username: profile.username),
          auth: widget.auth,
          reactions: widget.reactions,
          comments: widget.comments,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final profile = _profile;
    final error = _error;
    final Widget body;
    if (error != null) {
      body = StatusMessage(
        icon: Icons.person_off_outlined,
        title: 'Could not load this profile',
        detail: error,
        actionLabel: 'Retry',
        onAction: _load,
      );
    } else if (profile == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      final muted = theme.textTheme.bodyMedium?.copyWith(
        color: theme.colorScheme.onSurfaceVariant,
      );
      body = ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 28,
                child: Text(
                  profile.username.isEmpty
                      ? '?'
                      : profile.username[0].toUpperCase(),
                  style: theme.textTheme.titleLarge,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(profile.username, style: theme.textTheme.titleLarge),
                    if (profile.joinedAt != null)
                      Text(
                        'Joined ${ProfileScreen._dateFormat.format(profile.joinedAt!.toLocal())}',
                        key: const Key('profile-joined'),
                        style: muted,
                      ),
                    if (profile.location.isNotEmpty)
                      Row(
                        children: [
                          Icon(
                            Icons.place_outlined,
                            size: 16,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              profile.location,
                              key: const Key('profile-location'),
                              style: muted,
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (profile.messages &&
              widget.threads != null &&
              widget.auth?.currentUser != null) ...[
            const SizedBox(height: 16),
            FilledButton.icon(
              key: const Key('profile-message'),
              onPressed: () => _message(profile),
              icon: const Icon(Icons.mail_outline),
              label: const Text('Message'),
            ),
          ],
          const SizedBox(height: 24),
          for (final feed in [PostFeed.pizza, PostFeed.bikes])
            Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                key: Key('profile-count-${feed.name}'),
                leading: Icon(
                  feed == PostFeed.pizza
                      ? Icons.local_pizza_outlined
                      : Icons.pedal_bike_outlined,
                ),
                title: Text(
                  ProfileScreen.countLabel(
                    feed.feeds.single,
                    profile.count(feed.feeds.single),
                  ),
                ),
                trailing: profile.count(feed.feeds.single) > 0
                    ? const Icon(Icons.chevron_right)
                    : null,
                onTap: profile.count(feed.feeds.single) > 0
                    ? () => _openPosts(profile, feed)
                    : null,
              ),
            ),
        ],
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(widget.username)),
      body: body,
    );
  }
}
