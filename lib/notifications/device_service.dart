import '../api/api_client.dart';

/// Registers this device for the signed-in member's personal push
/// notifications (messages, comments, replies), and forgets it again.
abstract class DeviceService {
  Future<void> register(String token, {required String platform});
  Future<void> remove(String token);
}

/// [DeviceService] over the REST API (`/api/me/devices`).
class ApiDeviceService implements DeviceService {
  ApiDeviceService(this._api);

  final ApiClient _api;

  @override
  Future<void> register(String token, {required String platform}) =>
      _api.post('/me/devices', body: {'token': token, 'platform': platform});

  @override
  Future<void> remove(String token) =>
      _api.delete('/me/devices/${Uri.encodeComponent(token)}');
}
