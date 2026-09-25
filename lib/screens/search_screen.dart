import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../data/post_repository.dart';
import '../messages/thread_service.dart';
import '../models/post.dart';
import '../posts/comment_service.dart';
import '../posts/concern_service.dart';
import '../posts/post_editor.dart';
import '../posts/profile_service.dart';
import '../posts/reaction_service.dart';
import '../posts/search_service.dart';
import '../posts/unread_tracker.dart';
import '../submissions/photo_picker.dart';
import '../widgets/post_tile.dart';
import '../widgets/status_message.dart';
import 'post_detail_screen.dart';
import 'profile_screen.dart';

/// The Search tab: a text box and a Search button. Nothing is sent while
/// typing; pressing Search (or the keyboard's search key) makes one
/// request and shows what came back in four groups, in the order the API
/// ranks them: members, posts by title, posts by bike or pizza details,
/// and posts by words in their story, each with a line of the story.
/// A member opens their profile (with [profiles]); a post opens as it
/// does from a feed, and with [unread] that marks it read.
class SearchScreen extends StatefulWidget {
  const SearchScreen({
    super.key,
    required this.search,
    required this.repository,
    this.auth,
    this.reactions,
    this.comments,
    this.concerns,
    this.profiles,
    this.threads,
    this.editor,
    this.photos,
    this.unread,
  });

  final SearchService search;
  final PostRepository repository;
  final AuthService? auth;
  final ReactionService? reactions;
  final CommentService? comments;
  final ConcernService? concerns;
  final ProfileService? profiles;
  final ThreadService? threads;
  final PostEditor? editor;
  final PhotoPicker? photos;
  final UnreadTracker? unread;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _controller = TextEditingController();
  SearchResults? _results;
  String? _error;
  bool _loading = false;

  /// What the last request asked for, so Retry repeats it even after the
  /// box was edited.
  String _asked = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _run([String? query]) async {
    final q = (query ?? _controller.text).trim();
    if (q.isEmpty || _loading) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
      _asked = q;
    });
    try {
      final results = await widget.search.search(q);
      if (!mounted || _asked != q) return;
      setState(() => _results = results);
    } on ApiException catch (e) {
      if (!mounted || _asked != q) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted && _asked == q) setState(() => _loading = false);
    }
  }

  void _openPost(Post post) {
    widget.unread?.markRead(post);
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PostDetailScreen(
          post: post,
          repository: widget.repository,
          reactions: widget.reactions,
          comments: widget.comments,
          concerns: widget.concerns,
          profiles: widget.profiles,
          threads: widget.threads,
          auth: widget.auth,
          editor: widget.editor,
          photos: widget.photos,
        ),
      ),
    );
  }

  void _openMember(String username) {
    final profiles = widget.profiles;
    if (profiles == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProfileScreen(
          username: username,
          profiles: profiles,
          repository: widget.repository,
          auth: widget.auth,
          reactions: widget.reactions,
          comments: widget.comments,
          threads: widget.threads,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Search')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('search-field'),
                    controller: _controller,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _run(),
                    decoration: const InputDecoration(
                      hintText: 'Members, titles, details, stories',
                      prefixIcon: Icon(Icons.search),
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                ValueListenableBuilder<TextEditingValue>(
                  valueListenable: _controller,
                  builder: (context, value, _) => FilledButton(
                    key: const Key('search-button'),
                    onPressed: value.text.trim().isEmpty || _loading
                        ? null
                        : _run,
                    child: const Text('Search'),
                  ),
                ),
              ],
            ),
          ),
          Expanded(child: _body(context)),
        ],
      ),
    );
  }

  Widget _body(BuildContext context) {
    final theme = Theme.of(context);
    if (_loading) return const Center(child: CircularProgressIndicator());
    final error = _error;
    if (error != null) {
      return StatusMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Search failed',
        detail: error,
        actionLabel: 'Retry',
        onAction: () => _run(_asked),
      );
    }
    final results = _results;
    if (results == null) {
      return _Hint(
        icon: Icons.manage_search,
        title: 'Find members and posts',
        detail:
            'A username, words from a title, a bike\'s brand, decade, color '
            'or type, a pizza style, or a word from a story.',
      );
    }
    if (results.isEmpty) {
      return _Hint(
        key: const Key('search-empty'),
        icon: Icons.search_off,
        title: 'Nothing matched',
        detail:
            'No member, title, detail or story matched "${results.query}". '
            'A story only matches whole words.',
      );
    }
    final unread = widget.unread;
    Widget post(Post post) => PostTile(
      key: Key('search-post-${post.id}'),
      post: post,
      unread: unread?.isUnread(post) ?? false,
      unseenComments: unread?.unseenLabel(post),
      onTap: () => _openPost(post),
    );
    return ListView(
      key: const Key('search-results'),
      children: [
        if (results.members.isNotEmpty) ...[
          const _Heading('Members'),
          for (final username in results.members)
            ListTile(
              key: Key('search-member-$username'),
              leading: const Icon(Icons.person_outline),
              title: Text(username),
              trailing: widget.profiles == null
                  ? null
                  : const Icon(Icons.chevron_right),
              onTap: widget.profiles == null
                  ? null
                  : () => _openMember(username),
            ),
        ],
        if (results.titles.isNotEmpty) ...[
          const _Heading('Matching titles'),
          for (final p in results.titles) post(p),
        ],
        if (results.details.isNotEmpty) ...[
          const _Heading('Matching details'),
          for (final p in results.details) post(p),
        ],
        if (results.text.isNotEmpty) ...[
          const _Heading('In the story'),
          for (final hit in results.text) ...[
            post(hit.post),
            if (hit.snippet.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  16 + PostTile.thumbWidth + 14,
                  0,
                  16,
                  10,
                ),
                child: Text(
                  hit.snippet,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
          ],
        ],
        const SizedBox(height: 24),
      ],
    );
  }
}

/// A group's title above its rows.
class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 6),
      child: Text(
        text,
        style: theme.textTheme.titleSmall?.copyWith(
          color: theme.colorScheme.primary,
        ),
      ),
    );
  }
}

/// Centered icon and text, before a search and when nothing matched.
class _Hint extends StatelessWidget {
  const _Hint({
    super.key,
    required this.icon,
    required this.title,
    required this.detail,
  });

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
            const SizedBox(height: 16),
            Text(title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              detail,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}
