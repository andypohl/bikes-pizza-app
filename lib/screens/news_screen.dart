import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../data/post_repository.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import '../widgets/post_article.dart';
import '../widgets/status_message.dart';

/// The News tab: one article at a time, the newest first, like the
/// website's news page. "Older" and "Newer" buttons float in the lower
/// corners; long-pressing (or hovering) one shows the date and title of the
/// article it leads to. Older articles are fetched a page at a time as the
/// reader goes back through them.
class NewsScreen extends StatefulWidget {
  const NewsScreen({super.key, required this.repository});

  final PostRepository repository;

  @override
  State<NewsScreen> createState() => _NewsScreenState();
}

class _NewsScreenState extends State<NewsScreen> {
  final _scrollController = ScrollController();
  final _posts = <Post>[];

  int _index = 0;
  int _page = 1;
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  String? _error;

  static final _dateFormat = DateFormat.yMMMd();

  @override
  void initState() {
    super.initState();
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
      final page = await widget.repository.fetchPosts(PostFeed.news, page: 1);
      if (!mounted) return;
      setState(() {
        _posts
          ..clear()
          ..addAll(page.posts);
        _hasMore = page.hasMore;
        _page = 1;
        _index = 0;
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

  String _describe(Object error) {
    if (error is PostFetchException) return error.message;
    return 'Check your connection and try again.';
  }

  void _show(int index) {
    setState(() => _index = index);
    if (_scrollController.hasClients) _scrollController.jumpTo(0);
  }

  void _newer() {
    if (_index > 0) _show(_index - 1);
  }

  /// Shows the next older article, fetching the next page first when the
  /// loaded ones run out.
  Future<void> _older() async {
    if (_index + 1 < _posts.length) {
      _show(_index + 1);
      return;
    }
    if (!_hasMore || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = _page + 1;
      final page = await widget.repository.fetchPosts(
        PostFeed.news,
        page: next,
      );
      if (!mounted) return;
      setState(() {
        _posts.addAll(page.posts);
        _hasMore = page.hasMore;
        _page = next;
      });
      if (_index + 1 < _posts.length) _show(_index + 1);
    } on Object catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not load more news: ${_describe(e)}')),
      );
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  /// The date and title of [post], for the buttons' tooltips.
  String _describePost(Post post) =>
      '${_dateFormat.format(post.publishedAt.toLocal())} · ${post.title}';

  @override
  Widget build(BuildContext context) {
    final current = _posts.isEmpty ? null : _posts[_index];
    return Scaffold(
      appBar: AppBar(
        title: const Text('News'),
        actions: [
          if (current != null && current.url.isNotEmpty)
            IconButton(
              tooltip: 'Open on bikes.pizza',
              icon: const Icon(Icons.open_in_browser),
              onPressed: () => PostArticle.open(current.url),
            ),
        ],
      ),
      body: _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null && _posts.isEmpty) {
      return StatusMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load news',
        detail: _error!,
        actionLabel: 'Retry',
        onAction: _refresh,
      );
    }

    if (_posts.isEmpty) {
      return StatusMessage(
        icon: Icons.newspaper_outlined,
        title: 'No news yet',
        detail: 'Nothing has been published in News yet.',
        actionLabel: 'Refresh',
        onAction: _refresh,
      );
    }

    final post = _posts[_index];
    final newer = _index > 0 ? _posts[_index - 1] : null;
    final older = _index + 1 < _posts.length ? _posts[_index + 1] : null;
    final hasOlder = older != null || _hasMore;

    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: _refresh,
          child: SingleChildScrollView(
            controller: _scrollController,
            physics: const AlwaysScrollableScrollPhysics(),
            // Room for the buttons below the credit line.
            padding: const EdgeInsets.only(bottom: 88),
            child: PostArticle(
              key: ValueKey(post.id),
              post: post,
              repository: widget.repository,
            ),
          ),
        ),
        if (hasOlder)
          Positioned(
            left: 16,
            bottom: 16,
            child: FloatingActionButton(
              key: const Key('news-older'),
              heroTag: 'news-older',
              tooltip: older == null
                  ? 'Older news'
                  : 'Older: ${_describePost(older)}',
              onPressed: _loadingMore ? null : _older,
              child: _loadingMore
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.arrow_back),
            ),
          ),
        if (newer != null)
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton(
              key: const Key('news-newer'),
              heroTag: 'news-newer',
              tooltip: 'Newer: ${_describePost(newer)}',
              onPressed: _newer,
              child: const Icon(Icons.arrow_forward),
            ),
          ),
      ],
    );
  }
}
