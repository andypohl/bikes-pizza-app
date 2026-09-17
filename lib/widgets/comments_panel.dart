import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';
import 'package:intl/intl.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../auth/session_expiry.dart';
import '../contract.dart';
import '../models/post.dart';
import '../posts/comment_service.dart';
import 'post_article.dart';

/// The comments under a bike or pizza post (docs/community-design.md):
/// the count, then the thread (top-level comments oldest first with
/// their first replies, "Show N more replies" and "Load more comments")
/// and a composer at the bottom. Signed-out readers see the count and a
/// hint to sign in; a post with comments switched off says so. Members
/// like, reply, report, edit their own comment for five minutes and
/// delete their own comments or any on their own post. Everything goes
/// through [comments]; without a service only the count shows.
class CommentsPanel extends StatefulWidget {
  const CommentsPanel({
    super.key,
    required this.post,
    this.comments,
    this.auth,
    this.now,
  });

  final Post post;
  final CommentService? comments;
  final AuthService? auth;

  /// The clock, for the edit window; tests pin it.
  final DateTime Function()? now;

  @override
  State<CommentsPanel> createState() => _CommentsPanelState();
}

class _CommentsPanelState extends State<CommentsPanel> {
  CommentPage? _page;
  int _count = 0;
  bool _loading = false;
  bool _loadingMore = false;
  String? _error;
  String? _loadedFor;
  bool _admin = false;
  StreamSubscription<AppUser?>? _users;

  /// What the composer is doing besides writing a new comment.
  Comment? _replyTo;
  Comment? _editing;

  DateTime get _now => (widget.now ?? DateTime.now)();
  AppUser? get _user => widget.auth?.currentUser;

  @override
  void initState() {
    super.initState();
    _count = widget.post.commentCount;
    _users = widget.auth?.userChanges.listen((_) => _refresh());
    _refresh();
  }

  @override
  void didUpdateWidget(covariant CommentsPanel old) {
    super.didUpdateWidget(old);
    if (old.post.id != widget.post.id) {
      _page = null;
      _count = widget.post.commentCount;
      _loadedFor = null;
      _replyTo = null;
      _editing = null;
      _refresh();
    }
  }

  @override
  void dispose() {
    _users?.cancel();
    super.dispose();
  }

  /// Loads the first page once someone is signed in; forgets it when
  /// they sign out.
  Future<void> _refresh() async {
    final service = widget.comments;
    final user = _user;
    if (service == null || !widget.post.commentsEnabled) return;
    if (user == null) {
      if (_loadedFor != null && mounted) {
        setState(() {
          _page = null;
          _error = null;
          _loadedFor = null;
        });
      }
      return;
    }
    if (user.uid == _loadedFor) return;
    _loadedFor = user.uid;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait<Object>([
        service.fetch(widget.post.id),
        widget.auth?.isAdmin() ?? Future.value(false),
      ]);
      if (!mounted || _loadedFor != user.uid) return;
      final page = results[0] as CommentPage;
      setState(() {
        _page = page;
        _count = page.count;
        _admin = results[1] as bool;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted || _loadedFor != user.uid) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
      if (error.sessionExpired && widget.auth != null) {
        await handleSessionExpired(context, widget.auth!);
      }
    }
  }

  Future<void> _loadMore() async {
    final service = widget.comments;
    final page = _page;
    if (service == null || page?.next == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final more = await service.fetch(widget.post.id, after: page!.next);
      if (!mounted) return;
      setState(() {
        _page = CommentPage(
          count: more.count,
          comments: [...page.comments, ...more.comments],
          next: more.next,
        );
        _count = more.count;
      });
    } on ApiException catch (error) {
      _fail(error);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _fail(ApiException error) async {
    if (!mounted) return;
    if (error.sessionExpired && widget.auth != null) {
      await handleSessionExpired(context, widget.auth!);
      return;
    }
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(error.message)));
  }

  // ---- changing the thread shown ------------------------------------------

  void _setComments(List<Comment> comments) {
    final page = _page ?? const CommentPage();
    setState(() {
      _page = CommentPage(count: _count, comments: comments, next: page.next);
    });
  }

  List<Comment> get _comments => _page?.comments ?? const [];

  /// The thread with [updated] in place of the comment with its id,
  /// wherever it sits.
  List<Comment> _replaced(Comment updated) => [
    for (final c in _comments)
      if (c.id == updated.id)
        updated.copyWith(replies: c.replies, replyCount: c.replyCount)
      else
        c.copyWith(
          replies: [
            for (final r in c.replies)
              if (r.id == updated.id) updated else r,
          ],
        ),
  ];

  void _added(Comment comment) {
    if (comment.parentId == null) {
      _setComments([..._comments, comment]);
    } else {
      _setComments([
        for (final c in _comments)
          if (c.id == comment.parentId)
            c.copyWith(
              replies: [...c.replies, comment],
              replyCount: c.replyCount + 1,
            )
          else
            c,
      ]);
    }
    if (!comment.isPending) _count += 1;
  }

  void _removed(Comment comment) {
    if (comment.parentId == null) {
      final replies = _comments
          .firstWhere((c) => c.id == comment.id, orElse: () => comment)
          .replies;
      _setComments([
        for (final c in _comments)
          if (c.id != comment.id)
            c
          else if (replies.isNotEmpty)
            Comment(
              id: c.id,
              createdAt: c.createdAt,
              status: 'removed',
              removed: true,
              replies: c.replies,
              replyCount: c.replyCount,
            ),
      ]);
    } else {
      _setComments([
        for (final c in _comments)
          if (c.id == comment.parentId)
            c.copyWith(
              replies: [
                for (final r in c.replies)
                  if (r.id != comment.id) r,
              ],
              replyCount: c.replyCount - 1,
            )
          else
            c,
      ]);
    }
    if (!comment.isPending) _count -= 1;
  }

  // ---- actions --------------------------------------------------------------

  Future<void> _send(String text) async {
    final service = widget.comments!;
    final editing = _editing;
    final replyTo = _replyTo;
    try {
      if (editing != null) {
        final saved = await service.edit(widget.post.id, editing.id, text);
        if (!mounted) return;
        _setComments(_replaced(saved));
        if (editing.isPending != saved.isPending) {
          _count += saved.isPending ? -1 : 1;
        }
      } else {
        final saved = await service.create(
          widget.post.id,
          text,
          parentId: replyTo?.parentId ?? replyTo?.id,
        );
        if (!mounted) return;
        _added(saved);
        if (saved.isPending) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Your comment is waiting for review.'),
            ),
          );
        }
      }
      setState(() {
        _replyTo = null;
        _editing = null;
      });
    } on ApiException catch (error) {
      await _fail(error);
      rethrow;
    }
  }

  Future<void> _like(Comment comment) async {
    final service = widget.comments!;
    final before = comment;
    final optimistic = comment.copyWith(
      liked: !comment.liked,
      likeCount: comment.likeCount + (comment.liked ? -1 : 1),
    );
    _setComments(_replaced(optimistic));
    try {
      final result = await service.like(widget.post.id, comment.id);
      if (!mounted) return;
      _setComments(
        _replaced(
          optimistic.copyWith(liked: result.liked, likeCount: result.likeCount),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      _setComments(_replaced(before));
      await _fail(error);
    }
  }

  Future<void> _showLikes(Comment comment) async {
    final service = widget.comments!;
    final List<CommentLike> likes;
    try {
      likes = await service.likes(widget.post.id, comment.id);
    } on ApiException catch (error) {
      await _fail(error);
      return;
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          key: const Key('comment-likes'),
          shrinkWrap: true,
          children: [
            ListTile(
              title: Text(
                likes.length == 1
                    ? 'Liked by 1 member'
                    : 'Liked by ${likes.length} members',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            for (final like in likes)
              ListTile(
                leading: const Icon(Icons.favorite, size: 18),
                title: Text(like.username),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _delete(Comment comment) async {
    final service = widget.comments!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this comment?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep'),
          ),
          FilledButton(
            key: const Key('comment-delete-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await service.delete(widget.post.id, comment.id);
      if (!mounted) return;
      _removed(comment);
      if (_editing?.id == comment.id) setState(() => _editing = null);
    } on ApiException catch (error) {
      await _fail(error);
    }
  }

  Future<void> _report(Comment comment) async {
    final service = widget.comments!;
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Report this comment'),
        children: [
          for (final entry in commentReportReasons.entries)
            SimpleDialogOption(
              key: Key('report-${entry.key}'),
              onPressed: () => Navigator.of(context).pop(entry.key),
              child: Text(entry.value),
            ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    try {
      await service.report(widget.post.id, comment.id, reason);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Thanks. We'll take a look.")),
      );
    } on ApiException catch (error) {
      await _fail(error);
    }
  }

  Future<void> _moreReplies(Comment comment) async {
    final service = widget.comments!;
    try {
      final replies = await service.replies(widget.post.id, comment.id);
      if (!mounted) return;
      _setComments([
        for (final c in _comments)
          if (c.id == comment.id)
            c.copyWith(replies: replies, replyCount: replies.length)
          else
            c,
      ]);
    } on ApiException catch (error) {
      await _fail(error);
    }
  }

  // ---- layout ---------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    if (!post.takesComments) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final user = _user;
    final service = widget.comments;

    Widget body;
    if (!post.commentsEnabled) {
      body = Text('Comments are off for this post.', style: muted);
    } else if (service == null || user == null) {
      body = Text('Sign in from Settings to read the comments.', style: muted);
    } else if (_loading && _page == null) {
      body = const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(child: CircularProgressIndicator()),
      );
    } else if (_error != null && _page == null) {
      body = Row(
        children: [
          Expanded(child: Text(_error!, style: muted)),
          TextButton(
            onPressed: () {
              _loadedFor = null;
              _refresh();
            },
            child: const Text('Retry'),
          ),
        ],
      );
    } else {
      final page = _page ?? const CommentPage();
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final comment in page.comments) ...[
            _CommentTile(
              key: Key('comment-${comment.id}'),
              comment: comment,
              post: post,
              user: user,
              admin: _admin,
              now: _now,
              onLike: _like,
              onLikes: _showLikes,
              onReply: (c) => setState(() {
                _replyTo = c;
                _editing = null;
              }),
              onEdit: (c) => setState(() {
                _editing = c;
                _replyTo = null;
              }),
              onDelete: _delete,
              onReport: _report,
              onMoreReplies: _moreReplies,
            ),
            const SizedBox(height: 12),
          ],
          if (page.next != null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                key: const Key('comments-load-more'),
                onPressed: _loadingMore ? null : _loadMore,
                child: Text(_loadingMore ? 'Loading…' : 'Load more comments'),
              ),
            ),
          _Composer(
            key: ValueKey('composer-${_editing?.id ?? _replyTo?.id ?? ''}'),
            replyTo: _replyTo,
            editing: _editing,
            onCancel: () => setState(() {
              _replyTo = null;
              _editing = null;
            }),
            onSend: _send,
          ),
        ],
      );
    }

    return Padding(
      key: const Key('comments'),
      padding: const EdgeInsets.only(top: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _count == 1 ? '1 comment' : '$_count comments',
            key: const Key('comment-count'),
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 10),
          body,
        ],
      ),
    );
  }
}

/// One comment: who and when, the text, like / reply / menu, and its
/// replies indented beneath.
class _CommentTile extends StatelessWidget {
  const _CommentTile({
    super.key,
    required this.comment,
    required this.post,
    required this.user,
    required this.admin,
    required this.now,
    required this.onLike,
    required this.onLikes,
    required this.onReply,
    required this.onEdit,
    required this.onDelete,
    required this.onReport,
    required this.onMoreReplies,
    this.reply = false,
  });

  final Comment comment;
  final Post post;
  final AppUser user;
  final bool admin;
  final DateTime now;
  final ValueChanged<Comment> onLike;
  final ValueChanged<Comment> onLikes;
  final ValueChanged<Comment> onReply;
  final ValueChanged<Comment> onEdit;
  final ValueChanged<Comment> onDelete;
  final ValueChanged<Comment> onReport;
  final ValueChanged<Comment> onMoreReplies;
  final bool reply;

  static final _dateFormat = DateFormat.yMMMd().add_jm();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final canDelete =
        !comment.removed && (comment.mine || post.isBy(user.uid) || admin);
    final canEdit = comment.editableAt(now, commentEditWindow);
    final canReport = !comment.removed && !comment.mine;
    final hidden = comment.replyCount - comment.replies.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (comment.removed)
          Text(
            'Comment removed',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontStyle: FontStyle.italic,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          )
        else ...[
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            children: [
              Text(comment.username, style: theme.textTheme.labelLarge),
              Text(
                _dateFormat.format(comment.createdAt.toLocal()),
                style: muted,
              ),
              if (comment.editedAt != null) Text('(edited)', style: muted),
              if (comment.isPending)
                Text(
                  'Waiting for review',
                  key: Key('comment-pending-${comment.id}'),
                  style: muted?.copyWith(color: theme.colorScheme.tertiary),
                ),
            ],
          ),
          const SizedBox(height: 2),
          HtmlWidget(
            comment.html,
            textStyle: theme.textTheme.bodyMedium,
            onTapUrl: PostArticle.open,
          ),
          Row(
            children: [
              IconButton(
                key: Key('comment-like-${comment.id}'),
                tooltip: comment.liked ? 'Unlike' : 'Like',
                visualDensity: VisualDensity.compact,
                iconSize: 18,
                icon: Icon(
                  comment.liked ? Icons.favorite : Icons.favorite_border,
                  color: comment.liked ? theme.colorScheme.primary : null,
                ),
                onPressed: comment.isPending ? null : () => onLike(comment),
              ),
              if (comment.likeCount > 0)
                InkWell(
                  key: Key('comment-likes-${comment.id}'),
                  onTap: () => onLikes(comment),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: Text('${comment.likeCount}', style: muted),
                  ),
                ),
              TextButton(
                key: Key('comment-reply-${comment.id}'),
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                ),
                onPressed: comment.isPending ? null : () => onReply(comment),
                child: const Text('Reply'),
              ),
              if (canEdit || canDelete || canReport)
                PopupMenuButton<String>(
                  key: Key('comment-menu-${comment.id}'),
                  tooltip: 'More',
                  iconSize: 18,
                  onSelected: (choice) => switch (choice) {
                    'edit' => onEdit(comment),
                    'delete' => onDelete(comment),
                    _ => onReport(comment),
                  },
                  itemBuilder: (context) => [
                    if (canEdit)
                      const PopupMenuItem(value: 'edit', child: Text('Edit')),
                    if (canDelete)
                      const PopupMenuItem(
                        value: 'delete',
                        child: Text('Delete'),
                      ),
                    if (canReport)
                      const PopupMenuItem(
                        value: 'report',
                        child: Text('Report'),
                      ),
                  ],
                ),
            ],
          ),
        ],
        if (comment.replies.isNotEmpty || hidden > 0)
          Padding(
            padding: const EdgeInsets.only(left: 20, top: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final r in comment.replies)
                  _CommentTile(
                    key: Key('comment-${r.id}'),
                    comment: r,
                    post: post,
                    user: user,
                    admin: admin,
                    now: now,
                    onLike: onLike,
                    onLikes: onLikes,
                    onReply: onReply,
                    onEdit: onEdit,
                    onDelete: onDelete,
                    onReport: onReport,
                    onMoreReplies: onMoreReplies,
                    reply: true,
                  ),
                if (hidden > 0)
                  TextButton(
                    key: Key('comment-more-replies-${comment.id}'),
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                    ),
                    onPressed: () => onMoreReplies(comment),
                    child: Text(
                      hidden == 1
                          ? 'Show 1 more reply'
                          : 'Show $hidden more replies',
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// The field a comment is written in, with bold, italic and link
/// buttons that put the Markdown markers around the selection, the
/// character count, and the Post button. Says what it is doing when it
/// is a reply or an edit, with a way out.
class _Composer extends StatefulWidget {
  const _Composer({
    super.key,
    required this.onSend,
    required this.onCancel,
    this.replyTo,
    this.editing,
  });

  final Future<void> Function(String text) onSend;
  final VoidCallback onCancel;
  final Comment? replyTo;
  final Comment? editing;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  late final _text = TextEditingController(text: widget.editing?.text ?? '');
  final _focus = FocusNode();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
    if (widget.replyTo != null || widget.editing != null) _focus.requestFocus();
  }

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  /// Puts [before] and [after] around the selection (or at the cursor).
  void _wrap(String before, String after) {
    final value = _text.value;
    final selection = value.selection.isValid
        ? value.selection
        : TextSelection.collapsed(offset: value.text.length);
    final selected = selection.textInside(value.text);
    final inserted = '$before$selected$after';
    _text.value = value
        .replaced(selection, inserted)
        .copyWith(
          selection: TextSelection.collapsed(
            offset: selection.start + before.length + selected.length,
          ),
        );
    _focus.requestFocus();
  }

  Future<void> _link() async {
    final value = _text.value;
    final selection = value.selection.isValid
        ? value.selection
        : TextSelection.collapsed(offset: value.text.length);
    final selected = selection.textInside(value.text);
    final url = await showDialog<String>(
      context: context,
      builder: (context) => _LinkDialog(),
    );
    if (url == null || url.isEmpty || !mounted) return;
    final label = selected.isEmpty ? 'link' : selected;
    _text.value = value
        .replaced(selection, '[$label]($url)')
        .copyWith(
          selection: TextSelection.collapsed(
            offset: selection.start + label.length + url.length + 4,
          ),
        );
    _focus.requestFocus();
  }

  Future<void> _send() async {
    final text = _text.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await widget.onSend(text);
      if (mounted) _text.clear();
    } on ApiException {
      // Reported by the panel; the text stays for another try.
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final replyTo = widget.replyTo;
    final editing = widget.editing;
    final length = _text.text.trim().length;
    final tooLong = length > commentMaxLength;
    return Column(
      key: const Key('comment-composer'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (replyTo != null || editing != null)
          Row(
            children: [
              Expanded(
                child: Text(
                  editing != null
                      ? 'Editing your comment'
                      : 'Replying to ${replyTo!.username}',
                  key: const Key('composer-mode'),
                  style: muted,
                ),
              ),
              IconButton(
                key: const Key('composer-cancel'),
                tooltip: 'Cancel',
                iconSize: 18,
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.close),
                onPressed: widget.onCancel,
              ),
            ],
          ),
        TextField(
          key: const Key('comment-text'),
          controller: _text,
          focusNode: _focus,
          minLines: 1,
          maxLines: 6,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            hintText: replyTo != null ? 'Write a reply' : 'Write a comment',
            border: const OutlineInputBorder(),
            isDense: true,
          ),
        ),
        Row(
          children: [
            IconButton(
              key: const Key('comment-bold'),
              tooltip: 'Bold',
              iconSize: 18,
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.format_bold),
              onPressed: () => _wrap('**', '**'),
            ),
            IconButton(
              key: const Key('comment-italic'),
              tooltip: 'Italic',
              iconSize: 18,
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.format_italic),
              onPressed: () => _wrap('_', '_'),
            ),
            IconButton(
              key: const Key('comment-link'),
              tooltip: 'Link',
              iconSize: 18,
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.link),
              onPressed: _link,
            ),
            const Spacer(),
            Text(
              '$length/$commentMaxLength',
              style: muted?.copyWith(
                color: tooLong ? theme.colorScheme.error : null,
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(
              key: const Key('comment-send'),
              onPressed: length == 0 || tooLong || _sending ? null : _send,
              child: Text(
                editing != null
                    ? 'Save'
                    : replyTo != null
                    ? 'Reply'
                    : 'Post',
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Asks for a link's address.
class _LinkDialog extends StatefulWidget {
  @override
  State<_LinkDialog> createState() => _LinkDialogState();
}

class _LinkDialogState extends State<_LinkDialog> {
  final _url = TextEditingController();

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add a link'),
      content: TextField(
        key: const Key('link-url'),
        controller: _url,
        autofocus: true,
        keyboardType: TextInputType.url,
        decoration: const InputDecoration(hintText: 'https://'),
        onSubmitted: (value) => Navigator.of(context).pop(value.trim()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('link-add'),
          onPressed: () => Navigator.of(context).pop(_url.text.trim()),
          child: const Text('Add'),
        ),
      ],
    );
  }
}
