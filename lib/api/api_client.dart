import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../auth/session_expiry.dart';

/// Thrown by [ApiClient] with a message safe to show to the user and the
/// API's error code (`invalid-argument`, `not-found`, ...; see docs/api.md).
class ApiException implements Exception {
  ApiException(
    this.message, {
    this.code = 'unavailable',
    this.sessionExpired = false,
  });

  final String message;
  final String code;

  /// True when the server no longer accepts the user's session; the UI
  /// should sign out (see `handleSessionExpired`).
  final bool sessionExpired;

  @override
  String toString() => message;
}

/// Calls the REST API on the submissions site (`docs/api.md`) as the
/// signed-in member: every request carries the Firebase ID token that
/// [token] provides, and JSON comes back decoded. Failures are
/// [ApiException]s.
class ApiClient {
  ApiClient({
    required this.baseUrl,
    required this.token,
    http.Client? client,
    this.timeout = const Duration(minutes: 2),
  }) : _client = client ?? http.Client();

  /// Origin of the API, without a trailing slash or the `/api` prefix.
  final String baseUrl;

  /// A fresh ID token, or null when nobody is signed in.
  final Future<String?> Function() token;

  /// Long enough for a photo upload on a slow connection.
  final Duration timeout;

  final http.Client _client;

  /// With [optionalAuth], a request goes out without a token when nobody
  /// is signed in (the public endpoints) rather than failing.
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, String>? query,
    bool optionalAuth = false,
  }) => _send('GET', path, query: query, optionalAuth: optionalAuth);

  Future<Map<String, dynamic>> post(String path, {Object? body}) =>
      _send('POST', path, body: body);

  Future<Map<String, dynamic>> patch(String path, {Object? body}) =>
      _send('PATCH', path, body: body);

  Future<Map<String, dynamic>> delete(String path) => _send('DELETE', path);

  Uri uri(String path, {Map<String, String>? query}) {
    final base = Uri.parse(baseUrl);
    return base.replace(
      path: '${base.path.replaceAll(RegExp(r'/$'), '')}/api$path',
      queryParameters: query == null || query.isEmpty ? null : query,
    );
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    bool optionalAuth = false,
  }) async {
    final idToken = await token();
    if (idToken == null && !optionalAuth) {
      throw ApiException(sessionExpiredMessage, sessionExpired: true);
    }
    final request = http.Request(method, uri(path, query: query))
      ..headers['Accept'] = 'application/json';
    if (idToken != null) request.headers['Authorization'] = 'Bearer $idToken';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    final http.Response response;
    try {
      response = await http.Response.fromStream(
        await _client.send(request).timeout(timeout),
      );
    } on TimeoutException {
      throw ApiException(
        'That took too long. Check your connection and try again.',
      );
    } on http.ClientException {
      throw ApiException('Could not reach bikes.pizza. Check your connection.');
    }

    Object? json;
    try {
      json = response.body.isEmpty ? null : jsonDecode(response.body);
    } on FormatException {
      json = null;
    }
    if (response.statusCode == 401) {
      throw ApiException(sessionExpiredMessage, sessionExpired: true);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = json is Map ? json['error'] : null;
      final code = error is Map ? error['code'] as String? : null;
      final message = error is Map ? error['message'] as String? : null;
      throw ApiException(
        message ?? 'Something went wrong. Please try again.',
        code: code ?? 'unavailable',
      );
    }
    if (json is Map<String, dynamic>) return json;
    throw ApiException('Unexpected reply from bikes.pizza.');
  }
}
