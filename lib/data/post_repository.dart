import '../config.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import 'ghost_content_api_repository.dart';
import 'rss_post_repository.dart';

/// One page of posts plus whether more pages are available.
class PostPage {
  const PostPage({required this.posts, required this.hasMore});

  final List<Post> posts;
  final bool hasMore;

  static const empty = PostPage(posts: [], hasMore: false);
}

/// Source of blog posts. Two implementations exist: the Ghost Content API
/// (preferred, supports paging and server-side tag filtering) and the public
/// RSS feed (no key required, but capped at 15 posts per feed).
abstract class PostRepository {
  /// Human readable name shown in Settings so it is obvious which backend
  /// the app is talking to.
  String get sourceName;

  /// Fetch a page of posts for [feed] in reverse chronological order.
  /// Pages are 1-based.
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1});

  /// Picks the best available backend for the current build configuration.
  factory PostRepository.forConfig() {
    if (GhostConfig.hasContentApiKey) {
      return GhostContentApiRepository(
        siteUrl: GhostConfig.siteUrl,
        apiKey: GhostConfig.contentApiKey,
      );
    }
    return RssPostRepository(siteUrl: GhostConfig.siteUrl);
  }
}

/// Thrown when a backend responds with something we cannot use.
class PostFetchException implements Exception {
  PostFetchException(this.message);

  final String message;

  @override
  String toString() => message;
}
