import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../contract.dart';

/// The device-side notification switches (the broadcast categories, which
/// are topic subscriptions rather than member preferences), whether the
/// permission has been asked for, and the topics this device is
/// subscribed to. Persisted with shared_preferences.
class NotificationSettings extends ChangeNotifier {
  NotificationSettings({
    Map<String, bool>? device,
    this.permissionAsked = false,
    Set<String>? subscribed,
  }) : _device = {..._defaults(), ...?device},
       _subscribed = {...?subscribed};

  static const _prefix = 'notify_';
  static const _askedKey = 'notify_permission_asked';
  static const _topicsKey = 'notify_topics';

  static Map<String, bool> _defaults() => {
    for (final c in notificationCategories)
      if (c.device) c.value: c.on,
  };

  /// The device categories, in the contract's order.
  static List<String> get deviceCategories => [
    for (final c in notificationCategories)
      if (c.device) c.value,
  ];

  final Map<String, bool> _device;
  final Set<String> _subscribed;

  /// Whether the notification permission has been asked for once.
  bool permissionAsked;

  bool isOn(String category) => _device[category] ?? false;

  /// The topics this device is currently subscribed to.
  Set<String> get subscribed => Set.unmodifiable(_subscribed);

  static Future<NotificationSettings> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final device = <String, bool>{};
      for (final category in deviceCategories) {
        final saved = prefs.getBool('$_prefix$category');
        if (saved != null) device[category] = saved;
      }
      return NotificationSettings(
        device: device,
        permissionAsked: prefs.getBool(_askedKey) ?? false,
        subscribed: (prefs.getStringList(_topicsKey) ?? const []).toSet(),
      );
    } on Object {
      return NotificationSettings();
    }
  }

  Future<void> setOn(String category, bool on) async {
    if (!_device.containsKey(category) || _device[category] == on) return;
    _device[category] = on;
    notifyListeners();
    await _save((prefs) => prefs.setBool('$_prefix$category', on));
  }

  Future<void> setPermissionAsked() async {
    if (permissionAsked) return;
    permissionAsked = true;
    await _save((prefs) => prefs.setBool(_askedKey, true));
  }

  /// Records the topics subscribed to, so the next start knows what to
  /// drop when a switch or the feed choice has changed.
  Future<void> setSubscribed(Set<String> topics) async {
    if (setEquals(topics, _subscribed)) return;
    _subscribed
      ..clear()
      ..addAll(topics);
    await _save((prefs) => prefs.setStringList(_topicsKey, topics.toList()));
  }

  Future<void> _save(Future<void> Function(SharedPreferences) write) async {
    try {
      await write(await SharedPreferences.getInstance());
    } on Object {
      // Persisting is best-effort; the in-memory value already changed.
    }
  }
}
