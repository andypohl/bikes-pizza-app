import '../api/api_client.dart';
import '../models/post.dart';

/// A post found by words in its story (`GET /api/search` in docs/api.md),
/// with about a line of the story around the first word that matched.
class SearchHit {
  const SearchHit({required this.post, this.snippet = ''});

  final Post post;
  final String snippet;
}

/// What a search found, in the order the API ranks it: members whose
/// username starts with what was typed, posts whose title matches, posts
/// whose bike or pizza details match, and posts whose story does. A post
/// is in one group only.
class SearchResults {
  const SearchResults({
    required this.query,
    this.members = const [],
    this.titles = const [],
    this.details = const [],
    this.text = const [],
  });

  final String query;
  final List<String> members;
  final List<Post> titles;
  final List<Post> details;
  final List<SearchHit> text;

  bool get isEmpty =>
      members.isEmpty && titles.isEmpty && details.isEmpty && text.isEmpty;

  factory SearchResults.fromJson(
    Map<String, dynamic> json, {
    required String siteUrl,
  }) {
    List<Post> posts(Object? list) => [
      if (list is List)
        for (final item in list)
          if (item is Map<String, dynamic>)
            Post.fromJson(item, siteUrl: siteUrl),
    ];
    final members = json['members'];
    final text = json['text'];
    return SearchResults(
      query: json['query'] as String? ?? '',
      members: [
        if (members is List)
          for (final item in members)
            if (item is Map && item['username'] is String)
              item['username'] as String,
      ],
      titles: posts(json['titles']),
      details: posts(json['details']),
      text: [
        if (text is List)
          for (final item in text)
            if (item is Map<String, dynamic>)
              SearchHit(
                post: Post.fromJson(item, siteUrl: siteUrl),
                snippet: item['snippet'] as String? ?? '',
              ),
      ],
    );
  }
}

/// Runs a search; the real one calls the REST API, tests use an in-memory
/// fake. Failures are [ApiException]s.
abstract class SearchService {
  /// Everything matching [query], at most [limit] per group.
  Future<SearchResults> search(String query, {int limit = 20});
}

/// [SearchService] over the REST API. The endpoint is public, so the
/// request goes out with the member's token when there is one and
/// without it otherwise.
class ApiSearchService implements SearchService {
  ApiSearchService(this._api, {this.siteUrl = ''});

  final ApiClient _api;

  /// Used for a post's URL only if the API left it out.
  final String siteUrl;

  @override
  Future<SearchResults> search(String query, {int limit = 20}) async =>
      SearchResults.fromJson(
        await _api.get(
          '/search',
          query: {'q': query, 'limit': '$limit'},
          optionalAuth: true,
        ),
        siteUrl: siteUrl,
      );
}
