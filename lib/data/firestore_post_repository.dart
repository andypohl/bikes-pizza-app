import 'package:http/http.dart' as http;

import '../models/post.dart';
import '../models/post_feed.dart';
import 'firestore.dart';
import 'post_repository.dart';

/// Reads published posts from the `posts` collection of the app's Firebase
/// project (the same documents the website is built from) over Firestore's
/// REST API, a page at a time, newest first.
class FirestorePostRepository implements PostRepository {
  FirestorePostRepository({
    required String projectId,
    required this.siteUrl,
    this.pageSize = 15,
    http.Client? client,
  }) : _firestore = FirestoreClient(projectId: projectId, client: client);

  final String siteUrl;
  final int pageSize;
  final FirestoreClient _firestore;

  /// The query for one page: published posts of the tab's feeds (and of
  /// one member, with [uid]), newest first, one row more than a page so
  /// the answer says whether another page exists.
  Map<String, Object?> structuredQuery(PostFeed feed, int page, {String? uid}) {
    final filters = [
      _equals('status', 'published'),
      feed.feeds.length == 1
          ? _equals('feed', feed.feeds.single)
          : _filter('feed', 'IN', feed.feeds),
      if (uid != null) _equals('credit.uid', uid),
    ];
    return {
      'from': [
        {'collectionId': 'posts'},
      ],
      'where': {
        'compositeFilter': {'op': 'AND', 'filters': filters},
      },
      'orderBy': [
        {
          'field': {'fieldPath': 'publishedAt'},
          'direction': 'DESCENDING',
        },
      ],
      'offset': (page - 1) * pageSize,
      'limit': pageSize + 1,
    };
  }

  /// The query behind [fetchChanges]: published posts changed after
  /// [since], only their feed and change time, at most [changesLimit].
  Map<String, Object?> changesQuery(DateTime since) => {
    'from': [
      {'collectionId': 'posts'},
    ],
    'select': {
      'fields': [
        {'fieldPath': 'feed'},
        {'fieldPath': 'changedAt'},
      ],
    },
    'where': {
      'compositeFilter': {
        'op': 'AND',
        'filters': [
          _equals('status', 'published'),
          _filter('changedAt', 'GREATER_THAN', since.toUtc().toIso8601String()),
        ],
      },
    },
    'orderBy': [
      {
        'field': {'fieldPath': 'changedAt'},
        'direction': 'DESCENDING',
      },
    ],
    'limit': changesLimit,
  };

  /// More changes than this since the tracker's baseline are not counted;
  /// the baseline moves up as posts are read, so it is rarely reached.
  static const changesLimit = 500;

  static Map<String, Object?> _equals(String field, Object? value) =>
      _filter(field, 'EQUAL', value);

  static Map<String, Object?> _filter(String field, String op, Object? value) =>
      {
        'fieldFilter': {
          'field': {'fieldPath': field},
          'op': op,
          'value': encodeValue(value),
        },
      };

  @override
  Future<PostPage> fetchPosts(
    PostFeed feed, {
    int page = 1,
    String? uid,
  }) async {
    final List<Map<String, dynamic>> rows;
    try {
      rows = await _firestore.runQuery(structuredQuery(feed, page, uid: uid));
    } on FirestoreException catch (e) {
      throw PostFetchException(e.message);
    }
    final posts = rows
        .take(pageSize)
        .map((row) => Post.fromJson(row, siteUrl: siteUrl))
        .toList(growable: false);
    return PostPage(posts: posts, hasMore: rows.length > pageSize);
  }

  @override
  Future<List<PostChange>> fetchChanges({required DateTime since}) async {
    final List<Map<String, dynamic>> rows;
    try {
      rows = await _firestore.runQuery(changesQuery(since));
    } on FirestoreException catch (e) {
      throw PostFetchException(e.message);
    }
    return [
      for (final row in rows)
        if (row['id'] is String &&
            row['feed'] is String &&
            DateTime.tryParse(row['changedAt'] as String? ?? '') != null)
          PostChange(
            id: row['id'] as String,
            feed: row['feed'] as String,
            changedAt: DateTime.parse(row['changedAt'] as String),
          ),
    ];
  }
}
