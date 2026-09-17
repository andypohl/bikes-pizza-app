import 'dart:convert';
import 'dart:typed_data';

import 'package:share_plus/share_plus.dart';

import '../api/api_client.dart';

/// Hands a member everything they have (their record, posts, comments,
/// likes and reactions; `GET /api/me/export` in docs/api.md) as a JSON
/// file through the device's share sheet. Failures are [ApiException]s.
abstract class DataExporter {
  Future<void> export();
}

/// [DataExporter] over the REST API and the share sheet.
class ApiDataExporter implements DataExporter {
  ApiDataExporter(this._api, {Future<void> Function(String json)? share})
    : _share = share ?? _shareFile;

  final ApiClient _api;
  final Future<void> Function(String json) _share;

  @override
  Future<void> export() async {
    final json = await _api.get('/me/export');
    await _share(const JsonEncoder.withIndent('  ').convert(json));
  }

  static Future<void> _shareFile(String json) async {
    await SharePlus.instance.share(
      ShareParams(
        files: [
          XFile.fromData(
            Uint8List.fromList(utf8.encode(json)),
            mimeType: 'application/json',
            name: 'bikes-pizza-export.json',
          ),
        ],
        fileNameOverrides: ['bikes-pizza-export.json'],
        subject: 'Your bikes.pizza data',
      ),
    );
  }
}
