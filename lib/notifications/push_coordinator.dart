import 'dart:async';

import '../app_settings.dart';
import '../auth/auth_service.dart';
import '../contract.dart';
import '../models/post_feed.dart';
import 'device_service.dart';
import 'notification_settings.dart';
import 'push_service.dart';

/// Keeps the device's push setup in step with what the person wants:
///
/// - topic subscriptions follow the device switches ([notifications]) and
///   the "Show me" choice ([settings]): a hidden feed's topics are dropped;
/// - the registration token is sent to the API for the signed-in member
///   ([devices]) so their personal notifications reach this device, and
///   is invalidated at sign-out so the next member starts fresh.
class PushCoordinator {
  PushCoordinator({
    required this.push,
    required this.settings,
    required this.notifications,
    required this.auth,
    this.devices,
    required this.platform,
  });

  final PushService push;
  final AppSettings settings;
  final NotificationSettings notifications;
  final AuthService auth;
  final DeviceService? devices;

  /// "ios" or "android", as the API records it.
  final String platform;

  StreamSubscription<AppUser?>? _users;
  StreamSubscription<String>? _tokens;
  String? _registeredUid;
  String? _registeredToken;
  bool _started = false;

  /// The feeds a broadcast category covers for this device's feed choice.
  static const _broadcastFeeds = [
    PostFeed.bikes,
    PostFeed.pizza,
    PostFeed.news,
  ];

  /// The topics the switches and feed choice call for.
  Set<String> desiredTopics() {
    final choice = settings.feedChoice;
    return {
      for (final entry in notificationTopics.entries)
        if (notifications.isOn(entry.key))
          for (final feed in _broadcastFeeds)
            if (_shown(feed, choice)) '${entry.value}-${feed.name}',
    };
  }

  static bool _shown(PostFeed feed, FeedChoice choice) => switch (feed) {
    PostFeed.bikes => choice.showsBikes,
    PostFeed.pizza => choice.showsPizza,
    _ => true,
  };

  /// Starts following the settings and the session. Safe to call once.
  void start() {
    if (_started) return;
    _started = true;
    settings.addListener(syncTopics);
    notifications.addListener(syncTopics);
    _users = auth.userChanges.listen((user) => syncDevice(user: user));
    _tokens = push.tokenRefreshes.listen((token) {
      _registeredToken = null; // the old one is gone
      syncDevice(token: token);
    });
    unawaited(syncTopics());
    unawaited(syncDevice());
  }

  void dispose() {
    settings.removeListener(syncTopics);
    notifications.removeListener(syncTopics);
    _users?.cancel();
    _tokens?.cancel();
  }

  /// Asks for the permission the first time, and records that it was
  /// asked so the person is not nagged. Resolves to whether it is granted.
  Future<bool> ensurePermission() async {
    if (notifications.permissionAsked) return push.granted;
    await notifications.setPermissionAsked();
    final granted = await push.requestPermission();
    if (granted) {
      await syncTopics();
      await syncDevice();
    }
    return granted;
  }

  /// Subscribes to the topics wanted and drops the rest.
  Future<void> syncTopics() async {
    final wanted = desiredTopics();
    final current = notifications.subscribed;
    for (final topic in current.difference(wanted)) {
      await push.unsubscribe(topic);
    }
    for (final topic in wanted.difference(current)) {
      await push.subscribe(topic);
    }
    await notifications.setSubscribed(wanted);
  }

  /// Registers the token for the signed-in member, or invalidates it when
  /// nobody is signed in any more.
  Future<void> syncDevice({AppUser? user, String? token}) async {
    final devices = this.devices;
    if (devices == null) return;
    user ??= auth.currentUser;
    if (user == null) {
      if (_registeredUid != null) {
        _registeredUid = null;
        _registeredToken = null;
        await push.resetToken();
      }
      return;
    }
    token ??= await push.token();
    if (token == null) return;
    if (_registeredUid == user.uid && _registeredToken == token) return;
    try {
      await devices.register(token, platform: platform);
      _registeredUid = user.uid;
      _registeredToken = token;
    } on Object {
      // Unverified email, or offline: tried again at the next change.
    }
  }
}
