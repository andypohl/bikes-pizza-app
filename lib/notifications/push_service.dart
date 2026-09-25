import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';

/// What a tapped notification points at: a post (`type` "post", [id] its
/// slug) or a conversation (`type` "thread", [id] the thread).
class PushTap {
  const PushTap({required this.type, required this.id});

  final String type;
  final String id;

  /// From a message's data payload; null when it names nothing to open.
  static PushTap? fromData(Map<String, dynamic> data) {
    final type = data['type'];
    final id = data['id'];
    if (type is! String || id is! String || id.isEmpty) return null;
    if (type != 'post' && type != 'thread') return null;
    return PushTap(type: type, id: id);
  }
}

/// The device's push messaging: permission, the registration token, topic
/// subscriptions and taps on notifications. The real one is Firebase
/// Cloud Messaging; tests use a fake.
abstract class PushService {
  /// Asks the system for permission to show notifications. Resolves to
  /// whether they may be shown (on Android before 13 they always may).
  Future<bool> requestPermission();

  /// Whether notifications may be shown right now, without asking.
  Future<bool> get granted;

  /// The device's registration token, or null when there is none (no
  /// permission on iOS, or messaging unavailable).
  Future<String?> token();

  /// A new token whenever the system issues one.
  Stream<String> get tokenRefreshes;

  Future<void> subscribe(String topic);
  Future<void> unsubscribe(String topic);

  /// Invalidates the token (a sign-out): pushes to it fail from then on,
  /// and the next [token] is a fresh one.
  Future<void> resetToken();

  /// A notification the person tapped while the app was running.
  Stream<PushTap> get taps;

  /// The notification that launched the app, if one did.
  Future<PushTap?> initialTap();
}

/// [PushService] on Firebase Cloud Messaging. Failures are swallowed where
/// a notification is a convenience (subscriptions, tokens); the app works
/// without them.
class FirebasePushService implements PushService {
  FirebasePushService({FirebaseMessaging? messaging})
    : _messaging = messaging ?? FirebaseMessaging.instance;

  final FirebaseMessaging _messaging;

  @override
  Future<bool> requestPermission() async {
    try {
      final settings = await _messaging.requestPermission();
      await _messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );
      return _allowed(settings.authorizationStatus);
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> get granted async {
    try {
      return _allowed(
        (await _messaging.getNotificationSettings()).authorizationStatus,
      );
    } on Object {
      return false;
    }
  }

  static bool _allowed(AuthorizationStatus status) =>
      status == AuthorizationStatus.authorized ||
      status == AuthorizationStatus.provisional;

  @override
  Future<String?> token() async {
    try {
      return await _messaging.getToken();
    } on Object {
      return null;
    }
  }

  @override
  Stream<String> get tokenRefreshes => _messaging.onTokenRefresh;

  @override
  Future<void> subscribe(String topic) async {
    try {
      await _messaging.subscribeToTopic(topic);
    } on Object {
      // Retried at the next start.
    }
  }

  @override
  Future<void> unsubscribe(String topic) async {
    try {
      await _messaging.unsubscribeFromTopic(topic);
    } on Object {
      // Retried at the next start.
    }
  }

  @override
  Future<void> resetToken() async {
    try {
      await _messaging.deleteToken();
    } on Object {
      // Nothing to invalidate.
    }
  }

  @override
  Stream<PushTap> get taps => FirebaseMessaging.onMessageOpenedApp
      .map((m) => PushTap.fromData(m.data))
      .where((t) => t != null)
      .cast<PushTap>();

  @override
  Future<PushTap?> initialTap() async {
    final message = await _messaging.getInitialMessage();
    return message == null ? null : PushTap.fromData(message.data);
  }
}
