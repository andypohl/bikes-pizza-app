import '../api/api_client.dart';

/// One comment as the API hands it out (`GET /api/posts/{id}/comments`
/// in docs/api.md): who wrote it, its rendered HTML, its status, the
/// member's own relation to it (liked, mine) and, on a top-level
/// comment, the first few replies and how many there are.
class Comment {
  const Comment({
    required this.id,
    required this.createdAt,
    this.parentId,
    this.uid,
    this.username = '',
    this.html = '',
    this.text,
    this.editedAt,
    this.status = 'published',
    this.hold,
    this.removed = false,
    this.likeCount = 0,
    this.liked = false,
    this.replyCount = 0,
    this.mine = false,
    this.replies = const [],
  });

  final String id;

  /// Null for a top-level comment, else the top-level comment's id.
  final String? parentId;

  /// Null on a removed comment.
  final String? uid;
  final String username;

  /// Rendered from the Markdown subset when the comment was written.
  final String html;

  /// The comment as written, only on the member's own comments.
  final String? text;

  final DateTime createdAt;
  final DateTime? editedAt;

  /// `published`, `pending` (held for review; only the author sees it)
  /// or `removed` (a placeholder over replies).
  final String status;

  /// Why a pending comment is held: `screen` or `words`.
  final String? hold;

  final bool removed;
  final int likeCount;
  final bool liked;

  /// How many replies the comment has; [replies] holds the first few.
  final int replyCount;
  final bool mine;
  final List<Comment> replies;

  bool get isPending => status == 'pending';
  bool get isReply => parentId != null;

  /// Whether the author may still edit it at [now] (the contract's
  /// five-minute window).
  bool editableAt(DateTime now, Duration window) =>
      mine && !removed && now.difference(createdAt) < window;

  Comment copyWith({
    int? likeCount,
    bool? liked,
    int? replyCount,
    List<Comment>? replies,
  }) => Comment(
    id: id,
    parentId: parentId,
    uid: uid,
    username: username,
    html: html,
    text: text,
    createdAt: createdAt,
    editedAt: editedAt,
    status: status,
    hold: hold,
    removed: removed,
    likeCount: likeCount ?? this.likeCount,
    liked: liked ?? this.liked,
    replyCount: replyCount ?? this.replyCount,
    mine: mine,
    replies: replies ?? this.replies,
  );

  static Comment? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = json['id'];
    final createdAt = DateTime.tryParse(json['createdAt'] as String? ?? '');
    if (id is! String || id.isEmpty || createdAt == null) return null;
    final replies = json['replies'];
    return Comment(
      id: id,
      parentId: json['parentId'] as String?,
      uid: json['uid'] as String?,
      username: json['username'] as String? ?? '',
      html: json['html'] as String? ?? '',
      text: json['text'] as String?,
      createdAt: createdAt,
      editedAt: DateTime.tryParse(json['editedAt'] as String? ?? ''),
      status: json['status'] as String? ?? 'published',
      hold: json['hold'] as String?,
      removed: json['removed'] == true,
      likeCount: (json['likeCount'] as num?)?.toInt() ?? 0,
      liked: json['liked'] == true,
      replyCount: (json['replyCount'] as num?)?.toInt() ?? 0,
      mine: json['mine'] == true,
      replies: [
        if (replies is List)
          for (final r in replies) ?Comment.fromJson(r),
      ],
    );
  }
}

/// A page of a post's thread: the post's published comment count, the
/// top-level comments of the page (oldest first, replies nested) and the
/// cursor for the next page, or null on the last.
class CommentPage {
  const CommentPage({this.count = 0, this.comments = const [], this.next});

  final int count;
  final List<Comment> comments;
  final String? next;

  factory CommentPage.fromJson(Map<String, dynamic> json) {
    final comments = json['comments'];
    return CommentPage(
      count: (json['count'] as num?)?.toInt() ?? 0,
      comments: [
        if (comments is List)
          for (final c in comments) ?Comment.fromJson(c),
      ],
      next: json['next'] as String?,
    );
  }
}

/// A member who liked a comment.
class CommentLike {
  const CommentLike({required this.username, required this.at});

  final String username;
  final DateTime at;
}

/// A mention notice: a comment on [post] named the member at [at].
class Notice {
  const Notice({
    required this.id,
    required this.kind,
    required this.post,
    required this.at,
    this.comment,
  });

  final String id;
  final String kind;

  /// The post's id (slug).
  final String post;
  final String? comment;
  final DateTime at;

  static Notice? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = json['id'];
    final post = json['post'];
    final at = DateTime.tryParse(json['at'] as String? ?? '');
    if (id is! String || post is! String || at == null) return null;
    return Notice(
      id: id,
      kind: json['kind'] as String? ?? 'mention',
      post: post,
      comment: json['comment'] as String?,
      at: at,
    );
  }
}

/// Reads and writes a post's comments and the member's notices; the real
/// one calls the REST API (docs/api.md), tests use an in-memory fake.
/// Failures are [ApiException]s with a message to show.
abstract class CommentService {
  /// A page of the thread; [after] is the id of the last top-level
  /// comment seen.
  Future<CommentPage> fetch(String postId, {String? after});

  /// Every reply of one top-level comment.
  Future<List<Comment>> replies(String postId, String commentId);

  /// Writes a comment, or a reply with [parentId]; the answer may be
  /// pending when the screening held it.
  Future<Comment> create(String postId, String text, {String? parentId});

  /// Replaces the member's own comment's text within the edit window.
  Future<Comment> edit(String postId, String commentId, String text);

  Future<void> delete(String postId, String commentId);

  /// Likes the comment or takes the like back; returns the new state.
  Future<({bool liked, int likeCount})> like(String postId, String commentId);

  Future<List<CommentLike>> likes(String postId, String commentId);

  /// Reports the comment for [reason] (a value from the contract's list).
  Future<void> report(String postId, String commentId, String reason);

  /// The member's mention notices after [since], oldest first.
  Future<List<Notice>> notices({DateTime? since});
}

/// [CommentService] over the REST API (`/api/posts/{id}/comments`).
class ApiCommentService implements CommentService {
  ApiCommentService(this._api);

  final ApiClient _api;

  String _thread(String postId) =>
      '/posts/${Uri.encodeComponent(postId)}/comments';

  String _one(String postId, String commentId) =>
      '${_thread(postId)}/${Uri.encodeComponent(commentId)}';

  @override
  Future<CommentPage> fetch(String postId, {String? after}) async =>
      CommentPage.fromJson(
        await _api.get(_thread(postId), query: {'after': ?after}),
      );

  @override
  Future<List<Comment>> replies(String postId, String commentId) async {
    final json = await _api.get('${_one(postId, commentId)}/replies');
    final replies = json['replies'];
    return [
      if (replies is List)
        for (final r in replies) ?Comment.fromJson(r),
    ];
  }

  Comment _comment(Map<String, dynamic> json) {
    final comment = Comment.fromJson(json['comment']);
    if (comment == null) {
      throw ApiException('Unexpected reply from bikes.pizza.');
    }
    return comment;
  }

  @override
  Future<Comment> create(
    String postId,
    String text, {
    String? parentId,
  }) async => _comment(
    await _api.post(
      _thread(postId),
      body: {'text': text, 'parentId': ?parentId},
    ),
  );

  @override
  Future<Comment> edit(String postId, String commentId, String text) async =>
      _comment(await _api.patch(_one(postId, commentId), body: {'text': text}));

  @override
  Future<void> delete(String postId, String commentId) =>
      _api.delete(_one(postId, commentId));

  @override
  Future<({bool liked, int likeCount})> like(
    String postId,
    String commentId,
  ) async {
    final json = await _api.post('${_one(postId, commentId)}/like');
    return (
      liked: json['liked'] == true,
      likeCount: (json['likeCount'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  Future<List<CommentLike>> likes(String postId, String commentId) async {
    final json = await _api.get('${_one(postId, commentId)}/likes');
    final likes = json['likes'];
    return [
      if (likes is List)
        for (final l in likes)
          if (l is Map && l['username'] is String)
            CommentLike(
              username: l['username'] as String,
              at:
                  DateTime.tryParse(l['at'] as String? ?? '') ??
                  DateTime.fromMillisecondsSinceEpoch(0),
            ),
    ];
  }

  @override
  Future<void> report(String postId, String commentId, String reason) =>
      _api.post('${_one(postId, commentId)}/report', body: {'reason': reason});

  @override
  Future<List<Notice>> notices({DateTime? since}) async {
    final json = await _api.get(
      '/me/notices',
      query: {'since': ?since?.toUtc().toIso8601String()},
    );
    final notices = json['notices'];
    return [
      if (notices is List)
        for (final n in notices) ?Notice.fromJson(n),
    ];
  }
}
