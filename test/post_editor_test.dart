import 'dart:convert';

import 'package:bikes_pizza/api/api_client.dart';
import 'package:bikes_pizza/models/post.dart';
import 'package:bikes_pizza/posts/post_editor.dart';
import 'package:bikes_pizza/submissions/submission_service.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _editable = {
  'id': 'p1',
  'title': '1992 GT Outpost',
  'feed': 'bikes',
  'slug': '1992-gt-outpost-abc123',
  'url': 'https://example.com/post/1992-gt-outpost-abc123/',
  'publishedAt': '2026-09-01T12:00:00.000Z',
  'image': {
    'base': 'https://files.example.com/o/posts%2Fa%2Fv1%2F',
    'version': 'v1',
    'width': 2000,
    'height': 1500,
    'sizes': [400, 800, 1200, 2000],
    'formats': ['webp', 'jpg'],
    'focus': {'x': 0.5, 'y': 0.5},
    'url': 'https://files.example.com/o/posts%2Fa%2Fv1%2F2000.jpg?alt=media',
  },
  'story': 'First.\n\nSecond.',
  'storyHasFormatting': false,
  'bike': {'brand': 'GT', 'year': '1990s', 'color': '', 'type': ''},
  'pizza': null,
  'pendingEdit': null,
};

void main() {
  ApiPostEditor editor(MockClient http) => ApiPostEditor(
    ApiClient(
      baseUrl: 'https://s.example.com',
      token: () async => 't',
      client: http,
    ),
  );

  test('myPosts lists summaries from /api/posts', () async {
    final e = editor(
      MockClient(
        (request) async => http.Response(
          jsonEncode({
            'posts': [
              {
                'id': 'p1',
                'title': 'A',
                'feed': 'pizza',
                'url': 'https://example.com/post/a/',
                'publishedAt': '2026-09-01T12:00:00.000Z',
                'image': {
                  'base': 'https://files.example.com/o/posts%2Fa%2Fv1%2F',
                  'sizes': [400, 800],
                },
              },
              {
                'id': 'p2',
                'title': 'B',
                'feed': 'bikes',
                'url': null,
                'publishedAt': null,
                'image': null,
              },
            ],
          }),
          200,
        ),
      ),
    );
    final posts = await e.myPosts();
    expect(posts.map((p) => p.id), ['p1', 'p2']);
    expect(
      posts[0].image?.url(400),
      'https://files.example.com/o/posts%2Fa%2Fv1%2F400.webp?alt=media',
    );
    expect(posts[0].publishedAt, DateTime.utc(2026, 9, 1, 12));
    expect(posts[1].image, isNull);
  });

  test('load reads the editable post', () async {
    late http.Request seen;
    final e = editor(
      MockClient((request) async {
        seen = request;
        return http.Response(jsonEncode(_editable), 200);
      }),
    );
    final post = await e.load('p1');
    expect(seen.url.path, '/api/posts/p1');
    expect(post.title, '1992 GT Outpost');
    expect(post.story, 'First.\n\nSecond.');
    expect(post.image?.aspectRatio, closeTo(4 / 3, 0.001));
    expect(post.bike?.brand, 'GT');
    expect(post.bike?.year, '1990s');
    expect(post.pizza, isNull);
    expect(post.hasPendingEdit, isFalse);

    final pending = EditablePost.fromJson({
      ..._editable,
      'pendingEdit': {'id': 's1', 'createdAt': '2026-09-02T00:00:00.000Z'},
    });
    expect(pending.pendingEditId, 's1');
  });

  test('save sends only the fields set and reads either outcome', () async {
    final bodies = <Map<String, dynamic>>[];
    var pending = true;
    final e = editor(
      MockClient((request) async {
        bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response(
          jsonEncode(
            pending
                ? {'status': 'pending', 'submissionId': 's1', 'notified': true}
                : {
                    'status': 'applied',
                    'post': {..._editable, 'title': 'Renamed'},
                  },
          ),
          200,
        );
      }),
    );
    final first = await e.save('p1', const PostEdit(title: 'Renamed'));
    expect(first.isPending, isTrue);
    expect(first.submissionId, 's1');
    expect(bodies[0], {'title': 'Renamed'});

    pending = false;
    final photo = SubmissionPhoto(
      bytes: Uint8List.fromList([1, 2, 3]),
      contentType: 'image/png',
      filename: 'a.png',
    );
    final second = await e.save(
      'p1',
      PostEdit(
        story: 'New story.',
        photo: photo,
        bike: const BikeDetails(brand: 'GT', year: '1980s'),
        pizza: const PizzaDetails(style: 'detroit'),
      ),
    );
    expect(second.isPending, isFalse);
    expect(second.post?.title, 'Renamed');
    expect(bodies[1], {
      'story': 'New story.',
      'image': {
        'data': base64Encode([1, 2, 3]),
        'contentType': 'image/png',
      },
      'bike': {'brand': 'GT', 'year': '1980s', 'color': '', 'type': ''},
      'pizza': {'style': 'detroit'},
    });
    expect(const PostEdit().isEmpty, isTrue);
  });
}
