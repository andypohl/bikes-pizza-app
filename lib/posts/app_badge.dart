import 'package:app_badge_plus/app_badge_plus.dart';
import 'package:flutter/services.dart';

/// The number on the app's icon.
abstract class AppBadge {
  /// Asks the system for leave to show a badge, where that is needed (iOS).
  /// Resolves to whether badges may be shown.
  Future<bool> requestPermission();

  /// Shows [count] on the icon, or clears it for zero.
  Future<void> update(int count);
}

/// [AppBadge] on the device: the app_badge_plus plugin sets the number,
/// and on iOS a small channel in the app delegate asks for the badge
/// permission. Failures are ignored: the badge is a convenience.
class PlatformAppBadge implements AppBadge {
  static const _channel = MethodChannel('bikes.pizza/badge');

  @override
  Future<bool> requestPermission() async {
    try {
      return await _channel.invokeMethod<bool>('requestPermission') ?? true;
    } on MissingPluginException {
      return true; // Android: no permission to ask for.
    } on PlatformException {
      return false;
    }
  }

  @override
  Future<void> update(int count) async {
    try {
      await AppBadgePlus.updateBadge(count);
    } on Object {
      // Unsupported launcher, or no permission.
    }
  }
}

/// No badge at all, for tests and platforms without one.
class NoAppBadge implements AppBadge {
  const NoAppBadge();

  @override
  Future<bool> requestPermission() async => false;

  @override
  Future<void> update(int count) async {}
}
