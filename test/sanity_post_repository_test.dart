import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pizza_predator/data/post_repository.dart';
import 'package:pizza_predator/data/sanity_post_repository.dart';
import 'package:pizza_predator/models/post_feed.dart';

Map<String, dynamic> _row(String slug, {String feed = 'pizza'}) => {
  'slug': slug,
  'title': 'Post $slug',
  'feed': feed,
  'publishedAt': '2025-04-12T04:12:00.000Z',
  'excerpt': null,
  'plain': 'Body of $slug',
  'image': 'https://cdn.sanity.io/images/p/d/$slug-2000x1500.jpg',
  'body': [
    {
      '_type': 'block',
      '_key': 'k1',
      'style': 'normal',
      'markDefs': [],
      'children': [
        {'_type': 'span', '_key': 's1', 'marks': [], 'text': 'Body of $slug'},
      ],
    },
  ],
};

String _result(List<Map<String, dynamic>> rows) =>
    jsonEncode({'ms': 3, 'query': '', 'result': rows});

void main() {
  SanityPostRepository repo(MockClient client, {int pageSize = 2}) =>
      SanityPostRepository(
        projectId: 'abc123',
        dataset: 'production',
        apiVersion: '2025-02-19',
        siteUrl: 'https://example.com',
        pageSize: pageSize,
        client: client,
      );

  test('queries the API CDN with a paged, ordered GROQ query', () {
    final uri = repo(
      MockClient((_) async => http.Response('', 200)),
      pageSize: 15,
    ).buildUri(PostFeed.all, 3);

    expect(uri.host, 'abc123.apicdn.sanity.io');
    expect(uri.path, '/v2025-02-19/data/query/production');
    expect(uri.queryParameters['query'], contains('_type == "post"'));
    expect(uri.queryParameters['query'], contains('order(publishedAt desc)'));
    expect(uri.queryParameters['query'], isNot(contains('feed in')));
    expect(uri.queryParameters[r'$start'], '30');
    expect(uri.queryParameters[r'$end'], '46'); // one extra row
    expect(uri.queryParameters.containsKey(r'$feeds'), isFalse);
  });

  test('lists one member with a reference match on the author', () {
    final uri = repo(MockClient((_) async => http.Response('', 200)))
        .buildUri(PostFeed.all, 1, author: 'm1');
    expect(uri.queryParameters['query'], contains(r'author._ref == $author'));
    expect(uri.queryParameters[r'$author'], '"m1"');
    final plain = repo(MockClient((_) async => http.Response('', 200)))
        .buildUri(PostFeed.all, 1);
    expect(plain.queryParameters['query'], isNot(contains('author._ref')));
  });

  test('filters feeds by the feed field', () {
    final r = repo(MockClient((_) async => http.Response('', 200)));
    final uri = r.buildUri(PostFeed.bikes, 1);
    expect(uri.queryParameters['query'], contains(r'feed in $feeds'));
    expect(uri.queryParameters[r'$feeds'], '["bikes"]');
    expect(
      r.buildUri(PostFeed.pizza, 1).queryParameters[r'$feeds'],
      '["pizza"]',
    );
    expect(r.buildUri(PostFeed.blog, 1).queryParameters[r'$feeds'], '["blog"]');
  });

  test('parses posts and detects further pages from the extra row', () async {
    final client = MockClient(
      (_) async => http.Response(
        _result([_row('a'), _row('b'), _row('c')]),
        200,
        headers: {'content-type': 'application/json'},
      ),
    );

    final page = await repo(client).fetchPosts(PostFeed.pizza);

    expect(page.hasMore, isTrue);
    expect(page.posts.map((p) => p.id), ['a', 'b']);
    final first = page.posts.first;
    expect(first.title, 'Post a');
    expect(first.url, 'https://example.com/post/a/');
    expect(
      first.featureImage,
      startsWith('https://cdn.sanity.io/images/p/d/a-2000x1500.jpg?'),
    );
    expect(first.featureImage, contains('auto=format'));
    expect(first.tags, ['pizza']);
    expect(first.excerpt, 'Body of a');
    expect(first.html, '<p>Body of a</p>');
    expect(first.publishedAt.toUtc().year, 2025);
    expect(first.author, isNull);
    expect(first.credit, isNull);
  });

  test(
    'parses the submitter and prefers their username as the credit',
    () async {
      final rows = [
        {
          ..._row('a'),
          'submittedBy': 'Ada',
          'author': {'id': 'm1', 'username': 'ada_bikes'},
        },
        {
          ..._row('b'),
          'submittedBy': 'Bob',
          'author': {'id': 'm2', 'username': ''},
        },
        {..._row('c'), 'submittedBy': 'Cy'},
      ];
      final client = MockClient((_) async => http.Response(_result(rows), 200));
      final posts = (await repo(client, pageSize: 3).fetchPosts(PostFeed.all))
          .posts;
      expect(posts[0].author?.id, 'm1');
      expect(posts[0].credit, 'ada_bikes');
      expect(posts[1].author?.id, 'm2');
      expect(posts[1].credit, 'Bob'); // no username chosen yet
      expect(posts[2].author, isNull);
      expect(posts[2].credit, 'Cy');
    },
  );

  test(
    'parses bike details on bike posts and ignores them elsewhere',
    () async {
      final rows = [
        {
          ..._row('a', feed: 'bikes'),
          'bike': {
            'brand': 'GT',
            'year': '1990s',
            'color': 'orange',
            'type': 'mtb',
          },
        },
        {
          ..._row('b', feed: 'bikes'),
          'bike': {'brand': null, 'year': null, 'color': null, 'type': null},
        },
        {
          ..._row('c', feed: 'bikes'),
          'bike': {'brand': ' Trek ', 'type': 'hovercraft'},
        },
        {
          ..._row('d'),
          'bike': {
            'brand': 'GT',
            'year': '1990s',
            'color': 'orange',
            'type': 'mtb',
          },
        },
      ];
      final client = MockClient((_) async => http.Response(_result(rows), 200));
      final r = repo(client, pageSize: 4);
      expect(
        r.buildUri(PostFeed.all, 1).queryParameters['query'],
        contains('"bike": bike { brand, year, color, type }'),
      );
      final posts = (await r.fetchPosts(PostFeed.all)).posts;

      final full = posts[0].bike!;
      expect(full.specs.map((s) => '${s.label}: ${s.value}'), [
        'Brand: GT',
        'Year: 1990s',
        'Color: Orange',
        'Type: MTB',
      ]);
      expect(full.line, 'GT · MTB · 1990s');
      expect(posts[1].bike, isNull); // nothing filled in
      final partial = posts[2].bike!;
      expect(
        partial.line,
        'Trek · hovercraft',
      ); // unknown values shown as stored
      expect(partial.specs.length, 2);
      expect(posts[3].bike, isNull); // not a bike post
    },
  );

  test('reports no more pages when the page is not full', () async {
    final client = MockClient(
      (_) async => http.Response(_result([_row('a')]), 200),
    );
    final page = await repo(client).fetchPosts(PostFeed.blog);
    expect(page.hasMore, isFalse);
    expect(page.posts.length, 1);
  });

  test('turns HTTP errors into PostFetchException', () async {
    final client = MockClient((_) async => http.Response('nope', 500));
    expect(
      () => repo(client).fetchPosts(PostFeed.blog),
      throwsA(isA<PostFetchException>()),
    );
  });
}
