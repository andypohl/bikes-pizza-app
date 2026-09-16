import 'dart:convert';

import 'package:bikes_pizza/data/firestore.dart';
import 'package:bikes_pizza/data/firestore_post_repository.dart';
import 'package:bikes_pizza/data/post_repository.dart';
import 'package:bikes_pizza/models/post_feed.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// One `posts` document as Firestore's REST API returns it.
Map<String, dynamic> _doc(
  String slug, {
  String feed = 'pizza',
  Map<String, dynamic>? details,
  Map<String, dynamic>? credit,
  bool image = true,
}) => {
  'document': {
    'name': 'projects/p/databases/(default)/documents/posts/$slug',
    'fields': {
      'slug': {'stringValue': slug},
      'feed': {'stringValue': feed},
      'title': {'stringValue': 'Post $slug'},
      'publishedAt': {'stringValue': '2025-04-12T04:12:00.000Z'},
      'status': {'stringValue': 'published'},
      'summary': {'stringValue': 'Body of $slug'},
      'html': {'stringValue': '<p>Body of $slug</p>'},
      'image': image
          ? {
              'mapValue': {
                'fields': {
                  'base': {
                    'stringValue':
                        'https://files.example.com/o/posts%2F$slug%2Fv1%2F',
                  },
                  'version': {'stringValue': 'v1'},
                  'width': {'integerValue': '2000'},
                  'height': {'integerValue': '1500'},
                  'sizes': {
                    'arrayValue': {
                      'values': [
                        {'integerValue': '400'},
                        {'integerValue': '800'},
                        {'integerValue': '2000'},
                      ],
                    },
                  },
                  'blur': {'stringValue': 'data:image/jpeg;base64,AAA='},
                  'focus': {
                    'mapValue': {
                      'fields': {
                        'x': {'doubleValue': 0.25},
                        'y': {'doubleValue': 0.75},
                      },
                    },
                  },
                },
              },
            }
          : {'nullValue': null},
      'details': details == null
          ? {'nullValue': null}
          : {
              'mapValue': {
                'fields': {
                  for (final e in details.entries)
                    e.key: {'stringValue': e.value},
                },
              },
            },
      'credit': credit == null
          ? {'nullValue': null}
          : {
              'mapValue': {
                'fields': {
                  for (final e in credit.entries)
                    e.key: {'stringValue': e.value},
                },
              },
            },
      'createdAt': {'timestampValue': '2025-04-12T04:12:00.000Z'},
    },
  },
  'readTime': '2025-04-12T04:12:01.000Z',
};

void main() {
  FirestorePostRepository repo(MockClient client, {int pageSize = 2}) =>
      FirestorePostRepository(
        projectId: 'my-project',
        siteUrl: 'https://example.com',
        pageSize: pageSize,
        client: client,
      );

  test('asks Firestore for a page of published posts, newest first', () {
    final query = repo(
      MockClient((_) async => http.Response('[]', 200)),
      pageSize: 15,
    ).structuredQuery(PostFeed.all, 3);

    expect(query['from'], [
      {'collectionId': 'posts'},
    ]);
    expect(query['offset'], 30);
    expect(query['limit'], 16); // one extra row
    expect(query['orderBy'], [
      {
        'field': {'fieldPath': 'publishedAt'},
        'direction': 'DESCENDING',
      },
    ]);
    final filters =
        ((query['where'] as Map)['compositeFilter'] as Map)['filters'] as List;
    expect(filters.length, 2);
    expect((filters[0] as Map)['fieldFilter'], {
      'field': {'fieldPath': 'status'},
      'op': 'EQUAL',
      'value': {'stringValue': 'published'},
    });
    // "All" is the gallery: bikes and pizza, never the news.
    expect((filters[1] as Map)['fieldFilter'], {
      'field': {'fieldPath': 'feed'},
      'op': 'IN',
      'value': {
        'arrayValue': {
          'values': [
            {'stringValue': 'bikes'},
            {'stringValue': 'pizza'},
          ],
        },
      },
    });
  });

  test('filters one feed with an equality and a member by credit', () {
    final r = repo(MockClient((_) async => http.Response('[]', 200)));
    List<Map> filters(Map<String, Object?> q) =>
        (((q['where'] as Map)['compositeFilter'] as Map)['filters'] as List)
            .cast<Map>();

    final bikes = filters(r.structuredQuery(PostFeed.bikes, 1));
    expect(bikes.length, 2);
    expect(bikes[1]['fieldFilter'], {
      'field': {'fieldPath': 'feed'},
      'op': 'EQUAL',
      'value': {'stringValue': 'bikes'},
    });
    expect(
      (filters(r.structuredQuery(PostFeed.news, 1))[1]['fieldFilter']
          as Map)['value'],
      {'stringValue': 'news'},
    );

    final mine = filters(r.structuredQuery(PostFeed.all, 1, uid: 'u1'));
    expect(mine.length, 3);
    expect(mine[2]['fieldFilter'], {
      'field': {'fieldPath': 'credit.uid'},
      'op': 'EQUAL',
      'value': {'stringValue': 'u1'},
    });
  });

  test('posts the query to the project\'s runQuery endpoint', () async {
    late http.Request seen;
    final client = MockClient((request) async {
      seen = request;
      return http.Response('[]', 200);
    });
    await repo(client).fetchPosts(PostFeed.pizza);
    expect(seen.method, 'POST');
    expect(seen.url.host, 'firestore.googleapis.com');
    expect(
      seen.url.path,
      '/v1/projects/my-project/databases/(default)/documents:runQuery',
    );
    final body = jsonDecode(seen.body) as Map;
    expect(body.keys, ['structuredQuery']);
    expect(seen.headers['Content-Type'], startsWith('application/json'));
  });

  test('parses posts and detects further pages from the extra row', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode([_doc('a'), _doc('b'), _doc('c')]),
        200,
        headers: {'content-type': 'application/json'},
      ),
    );

    final page = await repo(client).fetchPosts(PostFeed.pizza);

    expect(page.hasMore, isTrue);
    expect(page.posts.map((p) => p.id), ['a', 'b']);
    final first = page.posts.first;
    expect(first.title, 'Post a');
    expect(first.feed, 'pizza');
    expect(first.url, 'https://example.com/post/a/');
    expect(first.summary, 'Body of a');
    expect(first.html, '<p>Body of a</p>');
    expect(first.publishedAt.toUtc().year, 2025);
    expect(first.credit, isNull);
    expect(first.creditLabel, isNull);
    expect(first.details, isNull);

    final image = first.image!;
    expect(image.width, 2000);
    expect(image.height, 1500);
    expect(image.aspectRatio, closeTo(4 / 3, 0.001));
    expect(image.sizes, [400, 800, 2000]);
    expect(image.blur, startsWith('data:image/jpeg'));
    expect(image.focusX, 0.25);
    expect(image.focusY, 0.75);
    // The widest rendition that fits, else the smallest; WebP by default.
    expect(
      image.url(1200),
      'https://files.example.com/o/posts%2Fa%2Fv1%2F800.webp?alt=media',
    );
    expect(
      image.url(100, format: 'jpg'),
      'https://files.example.com/o/posts%2Fa%2Fv1%2F400.jpg?alt=media',
    );
    expect(
      image.largestUrl,
      'https://files.example.com/o/posts%2Fa%2Fv1%2F2000.webp?alt=media',
    );
  });

  test(
    'fetchChanges asks for feed and change time of posts changed since',
    () async {
      late http.Request seen;
      final client = MockClient((request) async {
        seen = request;
        return http.Response(
          jsonEncode([
            {
              'document': {
                'name': 'projects/p/databases/(default)/documents/posts/a',
                'fields': {
                  'feed': {'stringValue': 'bikes'},
                  'changedAt': {'stringValue': '2026-09-05T12:00:00.000Z'},
                },
              },
            },
            {
              'document': {
                'name': 'projects/p/databases/(default)/documents/posts/broken',
                'fields': {
                  'feed': {'stringValue': 'bikes'},
                },
              },
            },
            {'readTime': '2026-09-06T00:00:00.000Z'},
          ]),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final changes = await repo(client)
          .fetchChanges(since: DateTime.utc(2026, 9, 1));
      expect(changes.length, 1);
      expect(changes.single.id, 'a');
      expect(changes.single.feed, 'bikes');
      expect(changes.single.changedAt, DateTime.utc(2026, 9, 5, 12));

      final query = (jsonDecode(seen.body) as Map)['structuredQuery'] as Map;
      expect(query['select'], {
        'fields': [
          {'fieldPath': 'feed'},
          {'fieldPath': 'changedAt'},
        ],
      });
      final filters =
          (query['where'] as Map)['compositeFilter']['filters'] as List;
      expect(filters[1], {
        'fieldFilter': {
          'field': {'fieldPath': 'changedAt'},
          'op': 'GREATER_THAN',
          'value': {'stringValue': '2026-09-01T00:00:00.000Z'},
        },
      });
      expect(query['limit'], FirestorePostRepository.changesLimit);
    },
  );

  test('a news post may have no photo', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode([_doc('a', feed: 'news', image: false)]),
        200,
      ),
    );
    final page = await repo(client).fetchPosts(PostFeed.news);
    expect(page.hasMore, isFalse);
    expect(page.posts.single.image, isNull);
    expect(page.posts.single.url, 'https://example.com/news/a/');
  });

  test('reads the credit and prefers the username as its label', () async {
    final rows = [
      _doc('a', credit: {'uid': 'u1', 'username': 'ada_bikes', 'name': 'Ada'}),
      _doc('b', credit: {'uid': 'u2', 'username': '', 'name': 'Bob'}),
      _doc('c'),
    ];
    final client = MockClient(
      (_) async => http.Response(jsonEncode(rows), 200),
    );
    final posts = (await repo(client, pageSize: 3).fetchPosts(PostFeed.all))
        .posts;
    expect(posts[0].credit?.uid, 'u1');
    expect(posts[0].isBy('u1'), isTrue);
    expect(posts[0].isBy('u2'), isFalse);
    expect(posts[0].creditLabel, 'ada_bikes');
    expect(posts[1].creditLabel, 'Bob'); // no username chosen yet
    expect(posts[2].credit, isNull);
    expect(posts[2].isBy('u1'), isFalse);
    expect(posts[2].creditLabel, isNull);
  });

  test('reads details on bike and pizza posts', () async {
    final rows = [
      _doc(
        'a',
        feed: 'bikes',
        details: {
          'brand': 'GT',
          'year': '1990s',
          'color': 'orange',
          'type': 'mtb',
        },
      ),
      _doc(
        'b',
        feed: 'bikes',
        details: {'brand': ' Trek ', 'type': 'hovercraft'},
      ),
      _doc('c', details: {'style': 'detroit'}),
      _doc('d', feed: 'news', details: {'style': 'detroit'}),
    ];
    final client = MockClient(
      (_) async => http.Response(jsonEncode(rows), 200),
    );
    final posts = (await repo(client, pageSize: 4).fetchPosts(PostFeed.all))
        .posts;

    final full = posts[0].bike!;
    expect(full.specs.map((s) => '${s.label}: ${s.value}'), [
      'Brand: GT',
      'Year: 1990s',
      'Color: Orange',
      'Type: Mountain',
    ]);
    expect(full.line, 'GT · Mountain · 1990s');
    expect(
      posts[1].bike!.line,
      'Trek · hovercraft',
    ); // unknown values as stored
    expect(posts[1].bike!.specs.length, 2);
    expect(posts[2].pizza!.line, 'Detroit');
    expect(posts[2].details!.specs.single.label, 'Style');
    expect(posts[3].details, isNull); // details belong to a feed
  });

  test('turns HTTP errors and query errors into PostFetchException', () async {
    final client = MockClient((_) async => http.Response('nope', 500));
    expect(
      () => repo(client).fetchPosts(PostFeed.news),
      throwsA(isA<PostFetchException>()),
    );
    final failing = MockClient(
      (_) async => http.Response(
        jsonEncode([
          {
            'error': {'code': 400, 'message': 'The query requires an index.'},
          },
        ]),
        200,
      ),
    );
    expect(
      () => repo(failing).fetchPosts(PostFeed.news),
      throwsA(
        isA<PostFetchException>().having(
          (e) => e.message,
          'message',
          contains('index'),
        ),
      ),
    );
  });

  test('decodes every Firestore value type', () {
    expect(decodeValue({'stringValue': 'x'}), 'x');
    expect(decodeValue({'integerValue': '42'}), 42);
    expect(decodeValue({'doubleValue': 0.5}), 0.5);
    expect(decodeValue({'booleanValue': true}), isTrue);
    expect(decodeValue({'nullValue': null}), isNull);
    expect(
      decodeValue({'timestampValue': '2025-01-01T00:00:00Z'}),
      '2025-01-01T00:00:00Z',
    );
    expect(
      decodeValue({
        'arrayValue': {
          'values': [
            {'integerValue': '1'},
            {'stringValue': 'two'},
          ],
        },
      }),
      [1, 'two'],
    );
    expect(decodeValue({'arrayValue': {}}), isEmpty);
    expect(
      decodeValue({
        'mapValue': {
          'fields': {
            'a': {'stringValue': 'b'},
          },
        },
      }),
      {'a': 'b'},
    );
    expect(encodeValue('s'), {'stringValue': 's'});
    expect(encodeValue(3), {'integerValue': '3'});
    expect(encodeValue(['a']), {
      'arrayValue': {
        'values': [
          {'stringValue': 'a'},
        ],
      },
    });
  });
}
