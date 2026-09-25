import 'dart:convert';

import 'package:bikes_pizza/api/api_client.dart';
import 'package:bikes_pizza/posts/concern_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('ApiConcernService posts the report to /api/concerns', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response(
        jsonEncode({'reported': true, 'id': 'k1'}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final service = ApiConcernService(
      ApiClient(
        baseUrl: 'https://submissions.example.com',
        token: () async => 't',
        client: client,
      ),
    );
    await service.report(
      const ConcernReport(
        kind: 'post',
        reason: 'child_safety',
        target: 'blue-bike',
        details: 'Please look.',
      ),
    );
    expect(requests.single.method, 'POST');
    expect(requests.single.url.path, '/api/concerns');
    expect(jsonDecode(requests.single.body), {
      'kind': 'post',
      'reason': 'child_safety',
      'target': 'blue-bike',
      'details': 'Please look.',
    });
  });
}
