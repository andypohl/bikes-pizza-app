import 'dart:convert';

import 'package:bikes_pizza/api/api_client.dart';
import 'package:bikes_pizza/posts/profile_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('a profile parses, tolerating odd shapes', () {
    final profile = PublicProfile.fromJson({
      'uid': 'u1',
      'username': 'ada_bikes',
      'joinedAt': '2025-03-04T05:06:07.000Z',
      'location': 'Madison, WI',
      'counts': {'pizza': 2, 'bikes': 'many'},
      'messages': true,
    });
    expect(profile.uid, 'u1');
    expect(profile.joinedAt, DateTime.utc(2025, 3, 4, 5, 6, 7));
    expect(profile.count('pizza'), 2);
    expect(profile.count('bikes'), 0);
    expect(profile.messages, isTrue);
    final bare = PublicProfile.fromJson({'username': 'bob'});
    expect(bare.joinedAt, isNull);
    expect(bare.location, '');
    expect(bare.messages, isFalse);
  });

  test(
    'the API service asks without a token when nobody is signed in',
    () async {
      final requests = <http.Request>[];
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({'uid': 'u1', 'username': 'ada_bikes', 'counts': {}}),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      String? token;
      final service = ApiProfileService(
        ApiClient(
          baseUrl: 'https://submissions.example.com',
          token: () async => token,
          client: client,
        ),
      );
      final anon = await service.fetch('Ada_Bikes');
      expect(anon.username, 'ada_bikes');
      expect(requests.single.url.path, '/api/members/Ada_Bikes');
      expect(requests.single.headers.containsKey('Authorization'), isFalse);
      token = 't1';
      await service.fetch('ada_bikes');
      expect(requests.last.headers['Authorization'], 'Bearer t1');
    },
  );
}
