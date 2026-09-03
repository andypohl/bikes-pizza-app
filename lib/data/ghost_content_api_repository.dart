import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import 'post_repository.dart';

/// Reads posts from the Ghost Content API.
/// Docs: https://ghost.org/docs/content-api/
class GhostContentApiRepository implements PostRepository {
  GhostContentApiRepository({
    required this.siteUrl,
    required this.apiKey,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String siteUrl;
  final String apiKey;
  final http.Client _client;

  static const _fields = [
    'id',
    'uuid',
    'title',
    'slug',
    'url',
    'feature_image',
    'published_at',
    'excerpt',
    'custom_excerpt',
    'html',
  ];

  Uri buildUri(PostFeed feed, int page) {
    final params = <String, String>{
      'key': apiKey,
      'limit': '${GhostConfig.pageSize}',
      'page': '$page',
      'order': 'published_at desc',
      'include': 'tags',
      'fields': _fields.join(','),
    };
    if (feed.isFiltered) {
      // Ghost's NQL filter syntax: tag:[a,b] matches posts with any of the tags.
      params['filter'] = 'tag:[${feed.tagSlugs.join(',')}]';
    }
    return Uri.parse('$siteUrl/ghost/api/content/posts/')
        .replace(queryParameters: params);
  }

  @override
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1}) async {
    final response = await _client.get(
      buildUri(feed, page),
      headers: const {'Accept': 'application/json'},
    );
    if (response.statusCode != 200) {
      throw PostFetchException(
        'Ghost API returned HTTP ${response.statusCode}',
      );
    }

    final body = jsonDecode(response.body);
    if (body is! Map<String, dynamic>) {
      throw PostFetchException('Unexpected response from Ghost API');
    }
    final rawPosts = body['posts'];
    final posts = rawPosts is List
        ? rawPosts
              .whereType<Map<String, dynamic>>()
              .map(Post.fromGhostJson)
              .toList(growable: false)
        : const <Post>[];

    final meta = body['meta'];
    final pagination = meta is Map<String, dynamic> ? meta['pagination'] : null;
    final nextPage = pagination is Map<String, dynamic>
        ? pagination['next']
        : null;

    return PostPage(posts: posts, hasMore: nextPage != null);
  }
}
