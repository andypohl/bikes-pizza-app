import '../config.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import 'sanity_post_repository.dart';

/// One page of posts plus whether more pages are available.
class PostPage {
  const PostPage({required this.posts, required this.hasMore});

  final List<Post> posts;
  final bool hasMore;

  static const empty = PostPage(posts: [], hasMore: false);
}

/// Source of posts, backed by Sanity in the real app and by an in-memory
/// fake in tests.
abstract class PostRepository {
  /// Fetch a page of posts for [feed] in reverse chronological order.
  /// Pages are 1-based. With [author] (a member document id) only that
  /// member's posts are returned.
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1, String? author});

  /// The Sanity repository for this build (see [SanityConfig]).
  factory PostRepository.forConfig() => SanityPostRepository(
    projectId: SanityConfig.projectId,
    dataset: SanityConfig.dataset,
    apiVersion: SanityConfig.apiVersion,
    siteUrl: SanityConfig.siteUrl,
    pageSize: SanityConfig.pageSize,
  );
}

class PostFetchException implements Exception {
  PostFetchException(this.message);

  final String message;

  @override
  String toString() => message;
}
