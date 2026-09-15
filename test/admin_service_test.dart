import 'dart:convert';

import 'package:bikes_pizza/admin/admin_service.dart';
import 'package:bikes_pizza/api/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final _submission = <String, Object?>{
  'id': 's1',
  'kind': 'post',
  'post': null,
  'changes': null,
  'feed': 'bikes',
  'title': 'Trek 970',
  'from': 'Ada',
  'description': 'Story',
  'status': 'pending',
  'createdAt': '2026-09-04T16:00:00.000Z',
  'submittedBy': {'uid': 'u1', 'email': 'ada@example.com'},
  'image': {
    'width': 2048,
    'height': 1536,
    'photoUrl': 'https://f/photo',
    'thumbUrl': 'https://f/thumb',
  },
  'safeSearch': {
    'adult': 'VERY_UNLIKELY',
    'racy': 'UNLIKELY',
    'violence': 'VERY_UNLIKELY',
  },
  'people': {'faces': 0, 'faceConfidence': 0, 'persons': 1, 'personScore': 0.2},
  'queue': null,
  'review': null,
};

final _edit = <String, Object?>{
  ..._submission,
  'id': 'e1',
  'kind': 'edit',
  'post': {
    'id': 'p1',
    'slug': 'trek-970',
    'title': 'Trek 970',
    'feed': 'bikes',
    'url': 'https://example.com/post/trek-970/',
    'imageUrl': 'https://cdn/trek.jpg',
  },
  'changes': {
    'title': 'Trek 970 (restored)',
    'image': false,
    'bike': {'brand': 'Trek'},
  },
  'title': 'Trek 970 (restored)',
  'image': {'width': null, 'height': null, 'photoUrl': null, 'thumbUrl': null},
};

void main() {
  final requests = <http.Request>[];
  ApiAdminService service(Object Function(http.Request) reply) {
    requests.clear();
    return ApiAdminService(
      ApiClient(
        baseUrl: 'https://s.example.com',
        token: () async => 't',
        client: MockClient((request) async {
          requests.add(request);
          return http.Response(jsonEncode(reply(request)), 200);
        }),
      ),
    );
  }

  test('submissions are listed with their filter and cursor', () async {
    final s = service(
      (_) => {
        'items': [_submission, _edit],
        'nextCursor': 'e1',
      },
    );
    final page = await s.submissions(status: 'pending', limit: 5, after: 'x');
    expect(requests.single.url.queryParameters, {
      'status': 'pending',
      'limit': '5',
      'after': 'x',
    });
    expect(page.hasNext, isTrue);
    expect(page.items.length, 2);

    final post = page.items[0];
    expect(post.isEdit, isFalse);
    expect(post.feedLabel, 'Bike');
    expect(post.submitterEmail, 'ada@example.com');
    expect(post.displayPhotoUrl, 'https://f/photo');
    expect(post.people?.summary, '1 person (0.2)');
    expect(post.safeSearch?['adult'], 'VERY_UNLIKELY');
    expect(post.isPending, isTrue);

    final edit = page.items[1];
    expect(edit.isEdit, isTrue);
    expect(edit.feedLabel, 'Edit · Bike');
    expect(edit.post?.title, 'Trek 970');
    expect(edit.changedFields, 'title, bike details');
    expect(edit.displayPhotoUrl, 'https://cdn/trek.jpg');
    expect(edit.thumbUrl, isNull);

    final all = service((_) => {'items': [], 'nextCursor': null});
    await all.submissions();
    expect(requests.single.url.queryParameters, {'limit': '20'});
  });

  test('review posts the action and note and describes the outcome', () async {
    final s = service(
      (_) => {
        'status': 'queued',
        'id': 's1',
        'position': 3,
        'feed': 'bikes',
        'countdown': '1h 30m 0s',
      },
    );
    final result = await s.review('s1', 'publish', note: 'nice');
    expect(requests.single.url.path, '/api/submissions/s1/review');
    expect(jsonDecode(requests.single.body), {
      'action': 'publish',
      'note': 'nice',
    });
    expect(
      result.message,
      'Queued at position 3 for Bike; next post in 1h 30m 0s.',
    );
    expect(
      ReviewResult.fromJson({
        'status': 'approved',
        'postUrl': 'https://x/p/',
        'postStatus': 'published',
      }).message,
      'Published: https://x/p/',
    );
    expect(ReviewResult.fromJson({'status': 'rejected'}).message, 'Rejected.');
  });

  test('queues, dequeue and the submit button use their endpoints', () async {
    final s = service((request) {
      if (request.url.path.endsWith('countdown-time')) {
        return {
          'feed': 'pizza',
          'length': 2,
          'nextPostAt': '2026-09-04T17:00:00.000Z',
          'countdown': '32m 14s',
        };
      }
      if (request.url.path.endsWith('/remove')) return {'status': 'pending'};
      return {'submitButton': request.method == 'POST' ? false : true};
    });
    final info = await s.queueInfo('pizza');
    expect(info.length, 2);
    expect(info.countdown, '32m 14s');
    await s.dequeue('pizza', 's2');
    expect(jsonDecode(requests.last.body), {'id': 's2'});
    expect(requests.last.url.path, '/api/queue/pizza/remove');
    expect(await s.submitButton(), isTrue);
    expect(await s.setSubmitButton(false), isFalse);
    expect(jsonDecode(requests.last.body), {'submitButton': false});
  });

  test(
    'users are paged and parsed; updates send only what was given',
    () async {
      final s = service((request) {
        if (request.method == 'PATCH') {
          return {'uid': 'u1', 'email': 'new@example.com', 'username': 'ada'};
        }
        if (request.method == 'DELETE') return {'deleted': 'u1'};
        if (request.url.path.endsWith('/u1')) {
          return {
            'uid': 'u1',
            'email': 'ada@example.com',
            'emailVerified': true,
            'username': 'ada',
            'subscribed': true,
            'providers': ['Email', 'Google'],
            'createdAt': '2026-01-01T00:00:00.000Z',
            'lastSignInAt': null,
            'postCount': 1,
            'latestPost': {
              'title': 'Trek',
              'publishedAt': '2026-02-01T00:00:00.000Z',
              'url': 'https://x/',
            },
            'newsletters': [
              {
                'id': 'news',
                'name': 'Newsletter',
                'description': '',
                'subscribed': true,
              },
            ],
            'posts': [
              {
                'title': 'Trek',
                'publishedAt': '2026-02-01T00:00:00.000Z',
                'url': 'https://x/',
              },
            ],
          };
        }
        return {
          'page': 2,
          'pageSize': 25,
          'total': 30,
          'pages': 2,
          'users': [
            {
              'uid': 'u1',
              'email': 'ada@example.com',
              'username': 'ada',
              'subscribed': true,
              'providers': [],
              'postCount': 1,
              'latestPost': null,
            },
            {
              'uid': 'u2',
              'email': '',
              'username': '',
              'subscribed': false,
              'providers': ['Apple'],
              'postCount': 0,
              'latestPost': null,
            },
          ],
        };
      });
      final page = await s.users(page: 2);
      expect(requests.single.url.queryParameters, {
        'page': '2',
        'pageSize': '25',
      });
      expect(page.pages, 2);
      expect(page.total, 30);
      expect(page.users[0].name, 'ada');
      expect(page.users[1].name, 'u2');

      final user = await s.user('u1');
      expect(user.hasPassword, isTrue);
      expect(user.providers, ['Email', 'Google']);
      expect(user.newsletters.single.subscribed, isTrue);
      expect(user.posts.single.title, 'Trek');
      expect(user.latestPost?.url, 'https://x/');

      final updated = await s.updateUser('u1', email: 'new@example.com');
      expect(jsonDecode(requests.last.body), {'email': 'new@example.com'});
      expect(updated.email, 'new@example.com');
      await s.updateUser('u1', username: 'ada', newsletters: []);
      expect(jsonDecode(requests.last.body), {
        'username': 'ada',
        'newsletters': [],
      });

      await s.deleteUser('u1');
      expect(requests.last.method, 'DELETE');
      expect(requests.last.url.path, '/api/admin/users/u1');
    },
  );
}
