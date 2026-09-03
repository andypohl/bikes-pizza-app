import 'package:flutter/material.dart';

import '../data/post_repository.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import '../widgets/post_tile.dart';
import 'post_detail_screen.dart';

/// Reverse-chronological list of posts for one [PostFeed], with pull-to-refresh
/// and infinite scrolling (when the backend supports paging).
class PostListScreen extends StatefulWidget {
  const PostListScreen({
    super.key,
    required this.feed,
    required this.repository,
  });

  final PostFeed feed;
  final PostRepository repository;

  @override
  State<PostListScreen> createState() => _PostListScreenState();
}

class _PostListScreenState extends State<PostListScreen> {
  final _scrollController = ScrollController();
  final _posts = <Post>[];

  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  int _page = 1;
  String? _error;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_maybeLoadMore);
    _refresh();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = _posts.isEmpty;
      _error = null;
    });
    try {
      final page = await widget.repository.fetchPosts(widget.feed, page: 1);
      if (!mounted) return;
      setState(() {
        _posts
          ..clear()
          ..addAll(page.posts);
        _hasMore = page.hasMore;
        _page = 1;
        _loading = false;
      });
    } on Object catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _describe(e);
      });
    }
  }

  void _maybeLoadMore() {
    if (!_hasMore || _loadingMore || _loading) return;
    final position = _scrollController.position;
    if (position.pixels >= position.maxScrollExtent - 400) {
      _loadMore();
    }
  }

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    try {
      final next = _page + 1;
      final page = await widget.repository.fetchPosts(widget.feed, page: next);
      if (!mounted) return;
      setState(() {
        _posts.addAll(page.posts);
        _hasMore = page.hasMore;
        _page = next;
      });
    } on Object catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not load more posts: ${_describe(e)}')),
      );
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  String _describe(Object error) {
    if (error is PostFetchException) return error.message;
    return 'Check your connection and try again.';
  }

  void _openPost(Post post) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PostDetailScreen(post: post),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.feed == PostFeed.blog ? 'Pizza Predator' : widget.feed.label,
        ),
      ),
      body: _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null && _posts.isEmpty) {
      return _Message(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load posts',
        detail: _error!,
        actionLabel: 'Retry',
        onAction: _refresh,
      );
    }

    if (_posts.isEmpty) {
      return _Message(
        icon: Icons.inbox_outlined,
        title: 'No posts yet',
        detail: 'Nothing has been published in ${widget.feed.label} yet.',
        actionLabel: 'Refresh',
        onAction: _refresh,
      );
    }

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.separated(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: _posts.length + (_hasMore ? 1 : 0),
        separatorBuilder: (_, _) => const Divider(height: 1, indent: 16),
        itemBuilder: (context, index) {
          if (index >= _posts.length) {
            return const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          final post = _posts[index];
          return PostTile(post: post, onTap: () => _openPost(post));
        },
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.icon,
    required this.title,
    required this.detail,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String actionLabel;
  final VoidCallback onAction;

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
            const SizedBox(height: 20),
            FilledButton.tonal(onPressed: onAction, child: Text(actionLabel)),
          ],
        ),
      ),
    );
  }
}
