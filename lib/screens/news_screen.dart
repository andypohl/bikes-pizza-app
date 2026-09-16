import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../auth/auth_service.dart';
import '../data/post_repository.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import '../posts/post_editor.dart';
import '../posts/unread_tracker.dart';
import '../submissions/photo_picker.dart';
import '../widgets/edit_post_button.dart';
import '../widgets/post_article.dart';
import '../widgets/status_message.dart';

/// The News tab: the articles in full, newest first, one after another.
/// Older pages load as the reader scrolls down. Only [maxPages] pages are
/// kept at a time: going further down drops the earliest page, and coming
/// back up fetches it again, so a long history never piles up in memory.
///
/// With [auth], [editor] and [photos], each article offers an Edit button
/// to administrators (news is written by the editors, so no member is
/// credited). With [unread], an article not read since it changed carries
/// a blue dot and counts as read once it has been on screen for a moment
/// while the tab is [active].
class NewsScreen extends StatefulWidget {
  const NewsScreen({
    super.key,
    required this.repository,
    this.maxPages = 10,
    this.auth,
    this.editor,
    this.photos,
    this.unread,
    this.active = true,
  });

  final PostRepository repository;
  final AuthService? auth;
  final PostEditor? editor;
  final PhotoPicker? photos;
  final UnreadTracker? unread;

  /// Whether this tab is the one showing; articles are only marked read
  /// while it is.
  final bool active;

  /// How many pages of articles to keep loaded at once.
  final int maxPages;

  @override
  State<NewsScreen> createState() => _NewsScreenState();
}

class _NewsScreenState extends State<NewsScreen> {
  final _scrollController = ScrollController();

  /// The loaded pages in order, page number to its articles.
  final _pages = <int, List<Post>>{};
  var _items = <Post>[];
  var _indexById = <String, int>{};

  int get _first => _pages.keys.first;
  int get _last => _pages.keys.last;

  bool _loading = true;
  bool _loadingNext = false;
  bool _loadingPrevious = false;
  bool _hasMore = false;
  String? _error;

  /// How close (in pixels) to either end the reader gets before the next
  /// page that way is fetched.
  static const _threshold = 1200.0;

  /// Where the last scroll event left the list, to tell which way the
  /// reader is going: pages are only added in that direction, so a short
  /// window cannot flip between fetching at its two ends.
  double _lastPixels = 0;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_maybeLoad);
    _refresh();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _rebuildItems() {
    _items = [for (final posts in _pages.values) ...posts];
    _indexById = {for (var i = 0; i < _items.length; i++) _items[i].id: i};
  }

  /// Shows an edited article as it now reads.
  void _replace(Post post) {
    setState(() {
      _pages.updateAll((_, posts) {
        final index = posts.indexWhere((p) => p.id == post.id);
        return index < 0 ? posts : (List.of(posts)..[index] = post);
      });
      _rebuildItems();
    });
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = _pages.isEmpty;
      _error = null;
    });
    try {
      final page = await widget.repository.fetchPosts(PostFeed.news, page: 1);
      if (!mounted) return;
      setState(() {
        _pages
          ..clear()
          ..[1] = page.posts;
        _rebuildItems();
        _hasMore = page.hasMore;
        _loading = false;
      });
      _fillViewport();
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

  void _maybeLoad() {
    if (_loading || _pages.isEmpty) return;
    final position = _scrollController.position;
    final pixels = position.pixels;
    final goingDown = pixels >= _lastPixels;
    _lastPixels = pixels;
    if (goingDown && pixels >= position.maxScrollExtent - _threshold) {
      _loadNext();
    } else if (!goingDown && pixels <= _threshold && _first > 1) {
      _loadPrevious();
    }
  }

  /// Short articles may not fill the screen, which leaves nothing to
  /// scroll; keep loading until they do, or until the window is full.
  void _fillViewport() {
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      final position = _scrollController.position;
      if (position.maxScrollExtent <= 0 &&
          _hasMore &&
          _pages.length < widget.maxPages) {
        _loadNext();
      }
    });
  }

  Future<void> _loadNext() async {
    if (!_hasMore || _loadingNext || _loadingPrevious) return;
    setState(() => _loadingNext = true);
    try {
      final number = _last + 1;
      final page = await widget.repository.fetchPosts(
        PostFeed.news,
        page: number,
      );
      if (!mounted) return;
      setState(() {
        _pages[number] = page.posts;
        if (_pages.length > widget.maxPages) _pages.remove(_first);
        _rebuildItems();
        _hasMore = page.hasMore;
      });
      _fillViewport();
    } on Object catch (e) {
      _report('Could not load more news', e);
    } finally {
      if (mounted) setState(() => _loadingNext = false);
    }
  }

  /// Fetches the page just above the window again, on the way back up.
  Future<void> _loadPrevious() async {
    if (_first <= 1 || _loadingPrevious || _loadingNext) return;
    setState(() => _loadingPrevious = true);
    try {
      final number = _first - 1;
      final page = await widget.repository.fetchPosts(
        PostFeed.news,
        page: number,
      );
      if (!mounted) return;
      setState(() {
        final kept = Map.of(_pages);
        _pages
          ..clear()
          ..[number] = page.posts
          ..addAll(kept);
        if (_pages.length > widget.maxPages) {
          _pages.remove(_last);
          // The dropped page will be fetched again on the way down.
          _hasMore = true;
        }
        _rebuildItems();
      });
    } on Object catch (e) {
      _report('Could not load earlier news', e);
    } finally {
      if (mounted) setState(() => _loadingPrevious = false);
    }
  }

  void _report(String what, Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text('$what: ${_describe(error)}')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('News')),
      body: _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null && _pages.isEmpty) {
      return StatusMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load news',
        detail: _error!,
        actionLabel: 'Retry',
        onAction: _refresh,
      );
    }

    if (_items.isEmpty) {
      return StatusMessage(
        icon: Icons.newspaper_outlined,
        title: 'No news yet',
        detail: 'Nothing has been published in News yet.',
        actionLabel: 'Refresh',
        onAction: _refresh,
      );
    }

    // Keyed items let the list keep what is on screen in place when a page
    // is dropped from, or put back at, the top.
    final unread = widget.unread;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListenableBuilder(
        listenable: unread ?? ValueNotifier<void>(null),
        builder: (context, _) => ListView.builder(
          controller: _scrollController,
          physics: const AlwaysScrollableScrollPhysics(),
          itemCount: _items.length + (_hasMore ? 1 : 0),
          findChildIndexCallback: (key) =>
              key is ValueKey<String> ? _indexById[key.value] : null,
          itemBuilder: (context, index) {
            if (index >= _items.length) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              );
            }
            final post = _items[index];
            return _NewsItem(
              key: ValueKey(post.id),
              post: post,
              repository: widget.repository,
              auth: widget.auth,
              editor: widget.editor,
              photos: widget.photos,
              onChanged: _replace,
              unread: unread,
              active: widget.active,
            );
          },
        ),
      ),
    );
  }
}

/// One article in the feed, with a rule under it and a button to open it
/// on bikes.pizza. An unread article is marked read once it has been on
/// screen for [readAfter] while the tab is active.
class _NewsItem extends StatefulWidget {
  const _NewsItem({
    super.key,
    required this.post,
    required this.repository,
    required this.onChanged,
    required this.active,
    this.auth,
    this.editor,
    this.photos,
    this.unread,
  });

  final Post post;
  final PostRepository repository;
  final ValueChanged<Post> onChanged;
  final bool active;
  final AuthService? auth;
  final PostEditor? editor;
  final PhotoPicker? photos;
  final UnreadTracker? unread;

  static const readAfter = Duration(seconds: 3);

  @override
  State<_NewsItem> createState() => _NewsItemState();
}

class _NewsItemState extends State<_NewsItem> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _watch();
  }

  @override
  void didUpdateWidget(_NewsItem old) {
    super.didUpdateWidget(old);
    if (old.active != widget.active || old.post != widget.post) _watch();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  /// Starts (or stops) the clock towards marking the article read.
  void _watch() {
    _timer?.cancel();
    _timer = null;
    final unread = widget.unread;
    if (!widget.active || unread == null || !unread.isUnread(widget.post)) {
      return;
    }
    _timer = Timer(_NewsItem.readAfter, () {
      if (mounted) unread.markRead(widget.post);
    });
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final auth = widget.auth;
    final editor = widget.editor;
    final photos = widget.photos;
    final editable = auth != null && editor != null && photos != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PostArticle(
          post: post,
          repository: widget.repository,
          unread: widget.unread?.isUnread(post) ?? false,
        ),
        if (post.url.isNotEmpty || editable)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Row(
              children: [
                if (post.url.isNotEmpty)
                  TextButton.icon(
                    onPressed: () => PostArticle.open(post.url),
                    icon: const Icon(Icons.open_in_browser),
                    label: const Text('Open on bikes.pizza'),
                  ),
                if (editable)
                  EditPostButton(
                    post: post,
                    auth: auth,
                    editor: editor,
                    photos: photos,
                    onSaved: widget.onChanged,
                    asTextButton: true,
                  ),
              ],
            ),
          ),
        const Divider(height: 1),
      ],
    );
  }
}
