import 'dart:convert';

import 'package:bikes_pizza/api/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  ApiClient client(
    MockClient http, {
    String? token = 'tok',
    String baseUrl = 'https://submissions.example.com',
  }) => ApiClient(baseUrl: baseUrl, token: () async => token, client: http);

  test('requests carry the ID token and land under /api', () async {
    late http.Request seen;
    final api = client(
      MockClient((request) async {
        seen = request;
        return http.Response(jsonEncode({'ok': true}), 200);
      }),
    );
    final out = await api.get('/posts', query: {'limit': '5'});
    expect(out, {'ok': true});
    expect(seen.method, 'GET');
    expect(
      seen.url.toString(),
      'https://submissions.example.com/api/posts?limit=5',
    );
    expect(seen.headers['Authorization'], 'Bearer tok');
    expect(seen.headers['Accept'], 'application/json');
  });

  test('a base URL with a path keeps it', () {
    final api = client(
      MockClient((_) async => http.Response('{}', 200)),
      baseUrl: 'http://localhost:5001/demo/us-central1/api/',
    );
    expect(
      api.uri('/me').toString(),
      'http://localhost:5001/demo/us-central1/api/api/me',
    );
  });

  test('bodies are sent as JSON', () async {
    late http.Request seen;
    final api = client(
      MockClient((request) async {
        seen = request;
        return http.Response(jsonEncode({'id': 'p1'}), 200);
      }),
    );
    await api.patch('/posts/p1', body: {'title': 'New'});
    expect(seen.method, 'PATCH');
    expect(seen.headers['Content-Type'], startsWith('application/json'));
    expect(jsonDecode(seen.body), {'title': 'New'});
  });

  test('API errors become ApiExceptions with the code and message', () async {
    final api = client(
      MockClient(
        (_) async => http.Response(
          jsonEncode({
            'error': {
              'code': 'not-found',
              'message': 'That post no longer exists.',
            },
          }),
          404,
        ),
      ),
    );
    await expectLater(
      api.get('/posts/x'),
      throwsA(
        isA<ApiException>()
            .having((e) => e.code, 'code', 'not-found')
            .having((e) => e.message, 'message', 'That post no longer exists.')
            .having((e) => e.sessionExpired, 'sessionExpired', isFalse),
      ),
    );
  });

  test('401 and a missing token mean the session expired', () async {
    final expired = client(MockClient((_) async => http.Response('', 401)));
    await expectLater(
      expired.get('/me'),
      throwsA(
        isA<ApiException>().having((e) => e.sessionExpired, 'expired', isTrue),
      ),
    );
    var calls = 0;
    final signedOut = client(
      MockClient((_) async {
        calls++;
        return http.Response('{}', 200);
      }),
      token: null,
    );
    await expectLater(
      signedOut.get('/me'),
      throwsA(
        isA<ApiException>().having((e) => e.sessionExpired, 'expired', isTrue),
      ),
    );
    expect(calls, 0);
  });

  test(
    'network failures and odd replies are reported, not thrown raw',
    () async {
      final down = client(
        MockClient((_) async => throw http.ClientException('refused')),
      );
      await expectLater(
        down.get('/me'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            contains('connection'),
          ),
        ),
      );
      final html = client(
        MockClient((_) async => http.Response('<html>', 200)),
      );
      await expectLater(html.get('/me'), throwsA(isA<ApiException>()));
      final unexplained = client(
        MockClient((_) async => http.Response('oops', 500)),
      );
      await expectLater(
        unexplained.get('/me'),
        throwsA(
          isA<ApiException>().having((e) => e.code, 'code', 'unavailable'),
        ),
      );
    },
  );
}
