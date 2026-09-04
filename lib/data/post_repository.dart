import '../config.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import 'ghost_content_api_repository.dart';

/// One page of posts plus whether more pages are available.
class PostPage {
  const PostPage({required this.posts, required this.hasMore});

  final List<Post> posts;
  final bool hasMore;

  static const empty = PostPage(posts: [], hasMore: false);
}

/// Source of blog posts, backed by the Ghost Content API in the real app and
/// by an in-memory fake in tests.
abstract class PostRepository {
  /// Fetch a page of posts for [feed] in reverse chronological order.
  /// Pages are 1-based.
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1});

  /// The Ghost Content API repository for this build.
  ///
  /// Throws if the build has no Content API key, which is a configuration
  /// mistake rather than a runtime condition: pass
  /// `--dart-define-from-file=config/local.json` (see README).
  factory PostRepository.forConfig() {
    if (!GhostConfig.hasContentApiKey) {
      throw StateError(
        'GHOST_CONTENT_API_KEY is not set. Build with '
        '--dart-define-from-file=config/local.json.',
      );
    }
    return GhostContentApiRepository(
      siteUrl: GhostConfig.siteUrl,
      apiKey: GhostConfig.contentApiKey,
    );
  }
}

/// Thrown when a backend responds with something we cannot use.
class PostFetchException implements Exception {
  PostFetchException(this.message);

  final String message;

  @override
  String toString() => message;
}
