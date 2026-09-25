import 'dart:convert';

import 'package:bikes_pizza/api/api_client.dart';
import 'package:bikes_pizza/notifications/device_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('ApiDeviceService registers and removes the device', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response(
        jsonEncode({'ok': true}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final service = ApiDeviceService(
      ApiClient(
        baseUrl: 'https://submissions.example.com',
        token: () async => 't',
        client: client,
      ),
    );
    await service.register('tok:en/1', platform: 'android');
    expect(requests.last.method, 'POST');
    expect(requests.last.url.path, '/api/me/devices');
    expect(jsonDecode(requests.last.body), {
      'token': 'tok:en/1',
      'platform': 'android',
    });
    await service.remove('tok:en/1');
    expect(requests.last.method, 'DELETE');
    expect(requests.last.url.path, '/api/me/devices/tok%3Aen%2F1');
  });
}
