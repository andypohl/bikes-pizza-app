import 'dart:convert';

import 'package:http/http.dart' as http;

/// Firestore over its REST API, read without credentials: the security
/// rules let anyone read what the website shows (published posts), so the
/// app needs no Firestore SDK or session for them.
///
/// `runQuery` answers in Firestore's typed JSON (`{"stringValue": ...}`,
/// `{"mapValue": {"fields": ...}}`); [decodeValue] turns that into plain
/// Dart values.
class FirestoreClient {
  FirestoreClient({required this.projectId, http.Client? client})
    : _client = client ?? http.Client();

  final String projectId;
  final http.Client _client;

  Uri get runQueryUri => Uri.https(
    'firestore.googleapis.com',
    '/v1/projects/$projectId/databases/(default)/documents:runQuery',
  );

  /// Runs a structured query and returns the matching documents' fields,
  /// each with its `id` (the last part of the document path) added.
  Future<List<Map<String, dynamic>>> runQuery(
    Map<String, Object?> structuredQuery,
  ) async {
    final response = await _client.post(
      runQueryUri,
      headers: const {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: jsonEncode({'structuredQuery': structuredQuery}),
    );
    if (response.statusCode != 200) {
      throw FirestoreException(
        'Firestore returned HTTP ${response.statusCode}',
      );
    }
    final rows = jsonDecode(response.body);
    if (rows is! List) throw FirestoreException('Unexpected Firestore reply');
    final docs = <Map<String, dynamic>>[];
    for (final row in rows.whereType<Map>()) {
      final error = row['error'];
      if (error is Map) {
        throw FirestoreException(error['message'] as String? ?? 'query failed');
      }
      final document = row['document'];
      if (document is! Map) continue;
      final fields = document['fields'];
      final name = document['name'] as String? ?? '';
      docs.add({
        ...decodeFields(fields is Map ? fields : const {}),
        'id': name.split('/').last,
      });
    }
    return docs;
  }
}

class FirestoreException implements Exception {
  FirestoreException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// A Firestore value as the plain value it stands for: strings, numbers,
/// booleans, null, lists and maps; timestamps stay ISO 8601 strings.
Object? decodeValue(Object? value) {
  if (value is! Map) return null;
  if (value.containsKey('nullValue')) return null;
  if (value.containsKey('stringValue')) return value['stringValue'];
  if (value.containsKey('booleanValue')) return value['booleanValue'];
  if (value.containsKey('integerValue')) {
    return int.tryParse(value['integerValue'].toString());
  }
  if (value.containsKey('doubleValue')) {
    return (value['doubleValue'] as num?)?.toDouble();
  }
  if (value.containsKey('timestampValue')) return value['timestampValue'];
  if (value.containsKey('arrayValue')) {
    final values = (value['arrayValue'] as Map?)?['values'];
    return values is List ? values.map(decodeValue).toList() : <Object?>[];
  }
  if (value.containsKey('mapValue')) {
    final fields = (value['mapValue'] as Map?)?['fields'];
    return decodeFields(fields is Map ? fields : const {});
  }
  return null;
}

Map<String, dynamic> decodeFields(Map<dynamic, dynamic> fields) => {
  for (final entry in fields.entries)
    entry.key.toString(): decodeValue(entry.value),
};

/// Firestore's typed JSON for a plain value, for query filters.
Map<String, Object?> encodeValue(Object? value) => switch (value) {
  null => {'nullValue': null},
  bool b => {'booleanValue': b},
  int i => {'integerValue': '$i'},
  double d => {'doubleValue': d},
  String s => {'stringValue': s},
  List l => {
    'arrayValue': {'values': l.map(encodeValue).toList()},
  },
  _ => throw ArgumentError('cannot encode ${value.runtimeType} for Firestore'),
};
