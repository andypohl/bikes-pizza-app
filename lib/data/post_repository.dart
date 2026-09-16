import '../models/post.dart';
import '../models/post_feed.dart';

/// One page of posts plus whether more pages are available.
class PostPage {
  const PostPage({required this.posts, required this.hasMore});

  final List<Post> posts;
  final bool hasMore;

  static const empty = PostPage(posts: [], hasMore: false);
}

/// A post that was published or edited: what the unread counters count.
class PostChange {
  const PostChange({
    required this.id,
    required this.feed,
    required this.changedAt,
  });

  final String id;

  /// The post's feed value (`bikes`, `pizza` or `news`).
  final String feed;
  final DateTime changedAt;
}

/// Source of posts, backed by Firestore in the real app
/// (`firestore_post_repository.dart`) and by an in-memory fake in tests.
abstract class PostRepository {
  /// Fetch a page of posts for [feed] in reverse chronological order.
  /// Pages are 1-based. With [uid] only the posts credited to that member
  /// are returned.
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1, String? uid});

  /// Every post published or edited after [since], newest change first.
  Future<List<PostChange>> fetchChanges({required DateTime since});
}

class PostFetchException implements Exception {
  PostFetchException(this.message);

  final String message;

  @override
  String toString() => message;
}
