import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pizza_predator/data/ghost_content_api_repository.dart';
import 'package:pizza_predator/data/post_repository.dart';
import 'package:pizza_predator/models/post_feed.dart';

Map<String, dynamic> _post(String id, {List<String> tags = const []}) => {
  'id': id,
  'title': 'Post $id',
  'url': 'https://example.com/$id/',
  'feature_image': 'https://example.com/$id.jpg',
  'published_at': '2025-04-12T04:12:00.000+00:00',
  'excerpt': 'Excerpt $id',
  'html': '<p>Body $id</p>',
  'tags': [
    for (final t in tags) {'slug': t, 'name': t},
  ],
};

String _body(List<Map<String, dynamic>> posts, {int? next}) => jsonEncode({
  'posts': posts,
  'meta': {
    'pagination': {'page': 1, 'limit': 15, 'pages': 2, 'next': next},
  },
});

void main() {
  GhostContentApiRepository repo(MockClient client) =>
      GhostContentApiRepository(
        siteUrl: 'https://example.com',
        apiKey: 'abc123',
        client: client,
      );

  test('builds an unfiltered, paged request for the blog feed', () {
    final uri = repo(MockClient((_) async => http.Response('', 200)))
        .buildUri(PostFeed.blog, 3);

    expect(uri.path, '/ghost/api/content/posts/');
    expect(uri.queryParameters['key'], 'abc123');
    expect(uri.queryParameters['page'], '3');
    expect(uri.queryParameters['order'], 'published_at desc');
    expect(uri.queryParameters['include'], 'tags');
    expect(uri.queryParameters.containsKey('filter'), isFalse);
  });

  test('filters tag feeds with NQL', () {
    final r = repo(MockClient((_) async => http.Response('', 200)));
    expect(
      r.buildUri(PostFeed.pizza, 1).queryParameters['filter'],
      'tag:[pizza]',
    );
    expect(
      r.buildUri(PostFeed.bikes, 1).queryParameters['filter'],
      'tag:[biking,off-road-biking]',
    );
  });

  test('parses posts and pagination', () async {
    final client = MockClient(
      (_) async => http.Response(
        _body([
          _post('a', tags: ['pizza']),
          _post('b'),
        ], next: 2),
        200,
        headers: {'content-type': 'application/json'},
      ),
    );

    final page = await repo(client).fetchPosts(PostFeed.pizza);

    expect(page.hasMore, isTrue);
    expect(page.posts.map((p) => p.id), ['a', 'b']);
    expect(page.posts.first.title, 'Post a');
    expect(page.posts.first.featureImage, 'https://example.com/a.jpg');
    expect(page.posts.first.tags, ['pizza']);
    expect(page.posts.first.publishedAt, DateTime.utc(2025, 4, 12, 4, 12));
  });

  test('reports the last page', () async {
    final client = MockClient(
      (_) async => http.Response(_body([_post('a')]), 200),
    );
    final page = await repo(client).fetchPosts(PostFeed.blog);
    expect(page.hasMore, isFalse);
  });

  test('throws on a non-200 response', () async {
    final client = MockClient((_) async => http.Response('denied', 401));
    expect(
      () => repo(client).fetchPosts(PostFeed.blog),
      throwsA(isA<PostFetchException>()),
    );
  });
}
