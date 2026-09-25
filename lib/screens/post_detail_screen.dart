import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../data/post_repository.dart';
import '../models/post.dart';
import '../posts/comment_service.dart';
import '../posts/concern_service.dart';
import '../posts/post_editor.dart';
import '../posts/profile_service.dart';
import '../messages/thread_service.dart';
import '../posts/reaction_service.dart';
import '../submissions/photo_picker.dart';
import '../widgets/edit_post_button.dart';
import '../widgets/post_article.dart';
import 'report_concern_screen.dart';

/// A post opened from a list: the [PostArticle] on its own page, with a
/// button to open it on bikes.pizza and, for the member who posted it or
/// an administrator, one to edit it (when [auth], [editor] and [photos]
/// are all given). An edit applied at once is shown here and reported
/// through [onChanged] so the list behind can catch up.
class PostDetailScreen extends StatefulWidget {
  const PostDetailScreen({
    super.key,
    required this.post,
    this.repository,
    this.reactions,
    this.comments,
    this.concerns,
    this.profiles,
    this.threads,
    this.auth,
    this.editor,
    this.photos,
    this.onChanged,
  });

  final Post post;
  final PostRepository? repository;
  final ReactionService? reactions;
  final CommentService? comments;

  /// With [auth], puts a Report button in the app bar; null leaves it out.
  final ConcernService? concerns;
  final ProfileService? profiles;
  final ThreadService? threads;
  final AuthService? auth;
  final PostEditor? editor;
  final PhotoPicker? photos;
  final ValueChanged<Post>? onChanged;

  @override
  State<PostDetailScreen> createState() => _PostDetailScreenState();
}

class _PostDetailScreenState extends State<PostDetailScreen> {
  late Post _post = widget.post;

  void _saved(Post post) {
    setState(() => _post = post);
    widget.onChanged?.call(post);
  }

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
    final editor = widget.editor;
    final photos = widget.photos;
    final concerns = widget.concerns;
    final post = _post;
    return Scaffold(
      appBar: AppBar(
        actions: [
          if (concerns != null && auth != null)
            IconButton(
              key: const Key('report-post'),
              tooltip: 'Report this post',
              icon: const Icon(Icons.flag_outlined),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => ReportConcernScreen(
                    concerns: concerns,
                    auth: auth,
                    post: post,
                  ),
                ),
              ),
            ),
          if (auth != null && editor != null && photos != null)
            EditPostButton(
              post: post,
              auth: auth,
              editor: editor,
              photos: photos,
              onSaved: _saved,
            ),
          if (post.url.isNotEmpty)
            IconButton(
              tooltip: 'Open on bikes.pizza',
              icon: const Icon(Icons.open_in_browser),
              onPressed: () => PostArticle.open(post.url),
            ),
        ],
      ),
      body: SingleChildScrollView(
        child: PostArticle(
          post: post,
          repository: widget.repository,
          reactions: widget.reactions,
          comments: widget.comments,
          profiles: widget.profiles,
          threads: widget.threads,
          auth: auth,
        ),
      ),
    );
  }
}
