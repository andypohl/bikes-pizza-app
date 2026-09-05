import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/post.dart';
import '../models/post_feed.dart';
import 'post_repository.dart';

/// Reads posts from Sanity with a GROQ query against the public dataset,
/// through the API CDN. Docs: https://www.sanity.io/docs/http-query
class SanityPostRepository implements PostRepository {
  SanityPostRepository({
    required this.projectId,
    required this.dataset,
    required this.apiVersion,
    required this.siteUrl,
    this.pageSize = 15,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String projectId;
  final String dataset;
  final String apiVersion;
  final String siteUrl;
  final int pageSize;
  final http.Client _client;

  /// The projection every post is fetched with. Body images get their asset
  /// URL projected in so the HTML converter can render them.
  static const projection = '''{
    "slug": slug.current, title, feed, publishedAt, excerpt,
    "plain": pt::text(body),
    "image": mainImage.asset->url,
    submittedBy,
    "author": author->{ "id": _id, "username": coalesce(username, "") },
    body[]{ ..., _type == "image" => { "url": asset->url } }
  }''';

  static String query(PostFeed feed, {bool byAuthor = false}) {
    final filter = feed.isFiltered ? ' && feed in \$feeds' : '';
    final author = byAuthor ? ' && author._ref == \$author' : '';
    return '*[_type == "post" && defined(slug.current)$filter$author]'
        ' | order(publishedAt desc) [\$start...\$end] $projection';
  }

  Uri buildUri(PostFeed feed, int page, {String? author}) {
    final start = (page - 1) * pageSize;
    // One extra row tells us whether another page exists.
    final end = start + pageSize + 1;
    return Uri.https(
      '$projectId.apicdn.sanity.io',
      '/v$apiVersion/data/query/$dataset',
      {
        'query': query(feed, byAuthor: author != null),
        '\$start': '$start',
        '\$end': '$end',
        if (feed.isFiltered) '\$feeds': jsonEncode(feed.feeds),
        if (author != null) '\$author': jsonEncode(author),
      },
    );
  }

  @override
  Future<PostPage> fetchPosts(
    PostFeed feed, {
    int page = 1,
    String? author,
  }) async {
    final response = await _client.get(
      buildUri(feed, page, author: author),
      headers: const {'Accept': 'application/json'},
    );
    if (response.statusCode != 200) {
      throw PostFetchException(
        'Sanity API returned HTTP ${response.statusCode}',
      );
    }

    final body = jsonDecode(response.body);
    final result = body is Map<String, dynamic> ? body['result'] : null;
    if (result is! List) {
      throw PostFetchException('Unexpected response from Sanity API');
    }
    final rows = result.whereType<Map<String, dynamic>>().toList();
    final hasMore = rows.length > pageSize;
    final posts = rows
        .take(pageSize)
        .map((row) => Post.fromSanityJson(row, siteUrl: siteUrl))
        .toList(growable: false);
    return PostPage(posts: posts, hasMore: hasMore);
  }
}
