import '../models/post.dart';
import '../models/post_feed.dart';

/// One page of posts plus whether more pages are available.
class PostPage {
  const PostPage({required this.posts, required this.hasMore});

  final List<Post> posts;
  final bool hasMore;

  static const empty = PostPage(posts: [], hasMore: false);
}

/// A post that was published, edited or commented on since some time:
/// what the unread counters count.
class PostChange {
  const PostChange({
    required this.id,
    required this.feed,
    required this.changedAt,
    this.commentedAt,
    this.commentTimes = const [],
  });

  final String id;

  /// The post's feed value (`bikes`, `pizza` or `news`).
  final String feed;
  final DateTime changedAt;

  /// When the newest published comment was written, when there is one,
  /// and the times of the newest ones (see `Post.commentTimes`).
  final DateTime? commentedAt;
  final List<DateTime> commentTimes;
}

/// Source of posts, backed by Firestore in the real app
/// (`firestore_post_repository.dart`) and by an in-memory fake in tests.
abstract class PostRepository {
  /// Fetch a page of posts for [feed] in reverse chronological order.
  /// Pages are 1-based. With [uid] only the posts credited to that member
  /// are returned.
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1, String? uid});

  /// Every post published, edited or commented on after [since], newest
  /// change first.
  Future<List<PostChange>> fetchChanges({required DateTime since});
}

class PostFetchException implements Exception {
  PostFetchException(this.message);

  final String message;

  @override
  String toString() => message;
}
