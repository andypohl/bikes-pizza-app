import 'dart:convert';

import 'package:bikes_pizza/api/api_client.dart';
import 'package:bikes_pizza/posts/comment_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  const comment = {
    'id': 'c1',
    'parentId': null,
    'uid': 'u1',
    'username': 'ada_bikes',
    'html': '<p>Hi <strong>@bob</strong></p>',
    'text': 'Hi @bob',
    'createdAt': '2026-09-10T10:00:00.000Z',
    'editedAt': '2026-09-10T10:02:00.000Z',
    'status': 'published',
    'removed': false,
    'likeCount': 2,
    'liked': true,
    'replyCount': 4,
    'mine': true,
    'replies': [
      {
        'id': 'c2',
        'parentId': 'c1',
        'uid': 'u2',
        'username': 'bob',
        'html': '<p>Hello</p>',
        'createdAt': '2026-09-10T10:05:00.000Z',
        'status': 'pending',
        'hold': 'screen',
      },
      'junk',
    ],
  };

  test('a comment page parses the thread, tolerating odd shapes', () {
    final page = CommentPage.fromJson({
      'count': 7,
      'comments': [
        comment,
        {'id': 'no-date'},
        {
          'id': 'gone',
          'createdAt': '2026-09-09T10:00:00.000Z',
          'status': 'removed',
          'removed': true,
        },
      ],
      'next': 'gone',
    });
    expect(page.count, 7);
    expect(page.next, 'gone');
    expect(page.comments.map((c) => c.id), ['c1', 'gone']);
    final first = page.comments.first;
    expect(first.username, 'ada_bikes');
    expect(first.text, 'Hi @bob');
    expect(first.editedAt, DateTime.utc(2026, 9, 10, 10, 2));
    expect(first.liked, isTrue);
    expect(first.likeCount, 2);
    expect(first.replyCount, 4);
    expect(first.mine, isTrue);
    expect(first.replies.map((r) => r.id), ['c2']);
    expect(first.replies.single.isPending, isTrue);
    expect(first.replies.single.hold, 'screen');
    expect(first.replies.single.isReply, isTrue);
    expect(page.comments.last.removed, isTrue);
    expect(page.comments.last.username, '');
    expect(
      first.editableAt(
        DateTime.utc(2026, 9, 10, 10, 4),
        const Duration(minutes: 5),
      ),
      isTrue,
    );
    expect(
      first.editableAt(
        DateTime.utc(2026, 9, 10, 10, 6),
        const Duration(minutes: 5),
      ),
      isFalse,
    );
    expect(first.copyWith(liked: false, likeCount: 1).likeCount, 1);
    expect(first.copyWith(liked: false).text, 'Hi @bob');
  });

  test('notices parse, dropping broken ones', () {
    expect(
      Notice.fromJson({
        'id': 'n1',
        'kind': 'mention',
        'post': 'slice',
        'comment': 'c1',
        'at': '2026-09-10T10:00:00.000Z',
      })?.at,
      DateTime.utc(2026, 9, 10, 10),
    );
    expect(Notice.fromJson({'id': 'n2', 'post': 'slice'}), isNull);
    expect(Notice.fromJson('x'), isNull);
  });

  group('ApiCommentService', () {
    final requests = <http.Request>[];
    Map<String, Object?> reply = {};

    ApiCommentService service() {
      requests.clear();
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode(reply),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      return ApiCommentService(
        ApiClient(
          baseUrl: 'https://submissions.example.com',
          token: () async => 't',
          client: client,
        ),
      );
    }

    test('fetch pages the thread', () async {
      reply = {
        'count': 1,
        'comments': [comment],
        'next': null,
      };
      final page = await service().fetch('slice', after: 'c0');
      expect(page.comments.single.id, 'c1');
      expect(
        requests.single.url.toString(),
        'https://submissions.example.com/api/posts/slice/comments?after=c0',
      );
      await service().fetch('slice');
      expect(requests.single.url.query, '');
    });

    test(
      'create, edit and delete send the text and read the comment',
      () async {
        reply = {'comment': comment};
        final s = service();
        final created = await s.create('slice', 'Hi @bob', parentId: 'c0');
        expect(created.id, 'c1');
        expect(requests.single.method, 'POST');
        expect(jsonDecode(requests.single.body), {
          'text': 'Hi @bob',
          'parentId': 'c0',
        });
        await s.create('slice', 'Top');
        expect(jsonDecode(requests.last.body), {'text': 'Top'});

        final edited = await s.edit('slice', 'c1', 'Hi again');
        expect(edited.id, 'c1');
        expect(requests.last.method, 'PATCH');
        expect(requests.last.url.path, '/api/posts/slice/comments/c1');
        expect(jsonDecode(requests.last.body), {'text': 'Hi again'});

        reply = {'removed': 'c1'};
        await s.delete('slice', 'c1');
        expect(requests.last.method, 'DELETE');
        expect(requests.last.url.path, '/api/posts/slice/comments/c1');
      },
    );

    test('a reply without a comment is an error', () async {
      reply = {'status': 'odd'};
      await expectLater(
        service().create('slice', 'x'),
        throwsA(isA<ApiException>()),
      );
    });

    test('like, likes, report and replies', () async {
      reply = {'liked': true, 'likeCount': 3};
      final s = service();
      expect(await s.like('slice', 'c1'), (liked: true, likeCount: 3));
      expect(requests.last.url.path, '/api/posts/slice/comments/c1/like');

      reply = {
        'likes': [
          {'username': 'bob', 'at': '2026-09-10T10:00:00.000Z'},
          {'nope': true},
        ],
      };
      final likes = await s.likes('slice', 'c1');
      expect(likes.map((l) => l.username), ['bob']);
      expect(likes.single.at, DateTime.utc(2026, 9, 10, 10));

      reply = {'reported': true, 'hidden': false};
      await s.report('slice', 'c1', 'spam');
      expect(requests.last.url.path, '/api/posts/slice/comments/c1/report');
      expect(jsonDecode(requests.last.body), {'reason': 'spam'});

      reply = {
        'id': 'c1',
        'replies': [(comment['replies'] as List)[0]],
      };
      final replies = await s.replies('slice', 'c1');
      expect(replies.map((r) => r.id), ['c2']);
      expect(requests.last.url.path, '/api/posts/slice/comments/c1/replies');
    });

    test('notices ask from a time', () async {
      reply = {
        'notices': [
          {
            'id': 'n1',
            'kind': 'mention',
            'post': 'slice',
            'comment': 'c1',
            'at': '2026-09-10T10:00:00.000Z',
          },
        ],
      };
      final notices = await service().notices(since: DateTime.utc(2026, 9, 1));
      expect(notices.single.post, 'slice');
      expect(
        requests.single.url.toString(),
        'https://submissions.example.com/api/me/notices?since=2026-09-01T00%3A00%3A00.000Z',
      );
    });
  });
}
