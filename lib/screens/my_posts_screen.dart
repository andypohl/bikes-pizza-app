import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../models/post_feed.dart';
import '../posts/post_editor.dart';
import '../submissions/photo_picker.dart';
import '../widgets/post_tile.dart';
import '../widgets/status_message.dart';
import 'edit_post_screen.dart';

/// Settings → Posts: the member's published posts, newest first; tapping
/// one opens it for editing.
class MyPostsScreen extends StatefulWidget {
  const MyPostsScreen({
    super.key,
    required this.editor,
    required this.photos,
    required this.auth,
  });

  final PostEditor editor;
  final PhotoPicker photos;
  final AuthService auth;

  @override
  State<MyPostsScreen> createState() => _MyPostsScreenState();
}

class _MyPostsScreenState extends State<MyPostsScreen> {
  List<PostSummary>? _posts;
  String? _error;

  static final _dateFormat = DateFormat.yMMMd();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
    });
    try {
      final posts = await widget.editor.myPosts();
      if (!mounted) return;
      setState(() => _posts = posts);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.sessionExpired) return handleSessionExpired(context, widget.auth);
      setState(() {
        _posts = null;
        _error = e.message;
      });
    }
  }

  Future<void> _open(PostSummary post) async {
    await Navigator.of(context).push<EditablePost>(
      MaterialPageRoute(
        builder: (_) => EditPostScreen(
          postId: post.id,
          editor: widget.editor,
          photos: widget.photos,
          auth: widget.auth,
        ),
      ),
    );
    // Titles or photos may have changed (an administrator's edit applies
    // at once); the list is cheap to fetch again.
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final posts = _posts;
    final error = _error;
    final Widget body;
    if (error != null) {
      body = StatusMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load your posts',
        detail: error,
        actionLabel: 'Retry',
        onAction: _load,
      );
    } else if (posts == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (posts.isEmpty) {
      body = StatusMessage(
        icon: Icons.inbox_outlined,
        title: 'No posts yet',
        detail:
            'Bikes and pizzas you submit appear here once they are '
            'published, ready to edit.',
        actionLabel: 'Refresh',
        onAction: _load,
      );
    } else {
      body = RefreshIndicator(
        onRefresh: _load,
        child: ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(),
          itemCount: posts.length,
          separatorBuilder: (_, _) => const Divider(height: 1, indent: 16),
          itemBuilder: (context, index) {
            final post = posts[index];
            final theme = Theme.of(context);
            final subtitle = theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            );
            return InkWell(
              key: Key('my-post-${post.id}'),
              onTap: () => _open(post),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
                child: Row(
                  children: [
                    PostThumbnail(
                      imageUrl: post.image?.url(400),
                      width: PostTile.thumbWidth,
                      height: PostTile.thumbHeight,
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            post.title,
                            style: theme.textTheme.titleMedium,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${feedNounLabel(post.feed)} · '
                            '${_dateFormat.format(post.publishedAt.toLocal())}',
                            style: subtitle,
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.edit_outlined),
                  ],
                ),
              ),
            );
          },
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Your posts')),
      body: body,
    );
  }
}
