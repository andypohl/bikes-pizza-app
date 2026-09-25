import 'dart:async';

import 'package:bikes_pizza/app_settings.dart';
import 'package:bikes_pizza/auth/auth_service.dart';
import 'package:bikes_pizza/notifications/device_service.dart';
import 'package:bikes_pizza/notifications/notification_settings.dart';
import 'package:bikes_pizza/notifications/push_coordinator.dart';
import 'package:bikes_pizza/notifications/push_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakePush implements PushService {
  final subscribed = <String>{};
  final log = <String>[];
  bool permission = true;
  bool asked = false;
  String? current = 'token-1';
  final _refreshes = StreamController<String>.broadcast();
  final _taps = StreamController<PushTap>.broadcast();

  @override
  Future<bool> requestPermission() async {
    asked = true;
    return permission;
  }

  @override
  Future<bool> get granted async => permission;

  @override
  Future<String?> token() async => current;

  @override
  Stream<String> get tokenRefreshes => _refreshes.stream;

  void refresh(String token) {
    current = token;
    _refreshes.add(token);
  }

  @override
  Future<void> subscribe(String topic) async {
    subscribed.add(topic);
    log.add('+$topic');
  }

  @override
  Future<void> unsubscribe(String topic) async {
    subscribed.remove(topic);
    log.add('-$topic');
  }

  @override
  Future<void> resetToken() async {
    log.add('reset');
    current = 'token-after-reset';
  }

  @override
  Stream<PushTap> get taps => _taps.stream;

  @override
  Future<PushTap?> initialTap() async => null;
}

class FakeDevices implements DeviceService {
  final registered = <(String, String)>[];
  final removed = <String>[];
  bool fail = false;

  @override
  Future<void> register(String token, {required String platform}) async {
    if (fail) throw StateError('offline');
    registered.add((token, platform));
  }

  @override
  Future<void> remove(String token) async => removed.add(token);
}

/// Just enough of [AuthService] for the coordinator: who is signed in.
class FakeAuth implements AuthService {
  final _users = StreamController<AppUser?>.broadcast();
  AppUser? _user;

  @override
  AppUser? get currentUser => _user;

  @override
  Stream<AppUser?> get userChanges => _users.stream;

  void set(AppUser? user) {
    _user = user;
    _users.add(user);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  late FakePush push;
  late FakeDevices devices;
  late FakeAuth auth;
  late AppSettings settings;
  late NotificationSettings notifications;

  PushCoordinator coordinator() => PushCoordinator(
    push: push,
    settings: settings,
    notifications: notifications,
    auth: auth,
    devices: devices,
    platform: 'ios',
  );

  setUp(() {
    push = FakePush();
    devices = FakeDevices();
    auth = FakeAuth();
    settings = AppSettings();
    notifications = NotificationSettings();
  });

  test('the topics wanted follow the switches and the feed choice', () {
    final c = coordinator();
    expect(c.desiredTopics(), {
      'new-posts-bikes',
      'new-posts-pizza',
      'new-posts-news',
    });
    settings = AppSettings(feedChoice: FeedChoice.pizzaOnly);
    notifications = NotificationSettings(
      device: {'newPosts': true, 'updatedPosts': true},
    );
    expect(coordinator().desiredTopics(), {
      'new-posts-pizza',
      'new-posts-news',
      'updated-posts-pizza',
      'updated-posts-news',
    });
    notifications = NotificationSettings(device: {'newPosts': false});
    expect(coordinator().desiredTopics(), isEmpty);
  });

  test(
    'syncTopics subscribes to what is wanted, drops the rest, and remembers',
    () async {
      notifications = NotificationSettings(
        subscribed: {'new-posts-bikes', 'old-topic'},
      );
      push.subscribed.addAll({'new-posts-bikes', 'old-topic'});
      final c = coordinator();
      await c.syncTopics();
      expect(push.subscribed, {
        'new-posts-bikes',
        'new-posts-pizza',
        'new-posts-news',
      });
      expect(push.log, contains('-old-topic'));
      expect(push.log, isNot(contains('+new-posts-bikes'))); // already had it
      expect(notifications.subscribed, push.subscribed);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getStringList('notify_topics')?.toSet(), push.subscribed);
    },
  );

  test(
    'a changed switch or feed choice re-syncs the topics once started',
    () async {
      final c = coordinator()..start();
      await Future<void>.delayed(Duration.zero);
      await settings.setFeedChoice(FeedChoice.bikesOnly);
      await Future<void>.delayed(Duration.zero);
      expect(push.subscribed, {'new-posts-bikes', 'new-posts-news'});
      await notifications.setOn('updatedPosts', true);
      await Future<void>.delayed(Duration.zero);
      expect(push.subscribed, contains('updated-posts-bikes'));
      expect(push.subscribed, isNot(contains('updated-posts-pizza')));
      c.dispose();
    },
  );

  test('the device is registered at sign-in, re-registered on a new token, and reset at sign-out', () async {
    final c = coordinator()..start();
    await Future<void>.delayed(Duration.zero);
    expect(devices.registered, isEmpty); // nobody signed in
    auth.set(
      const AppUser(uid: 'u1', email: 'a@b.c', providerIds: ['password']),
    );
    await Future<void>.delayed(Duration.zero);
    expect(devices.registered, [('token-1', 'ios')]);
    // Same member, same token: nothing more is sent.
    await c.syncDevice();
    expect(devices.registered.length, 1);
    push.refresh('token-2');
    await Future<void>.delayed(Duration.zero);
    expect(devices.registered.last, ('token-2', 'ios'));
    auth.set(null);
    await Future<void>.delayed(Duration.zero);
    expect(push.log, contains('reset'));
    // A second sign-out does nothing more.
    auth.set(null);
    await Future<void>.delayed(Duration.zero);
    expect(push.log.where((e) => e == 'reset').length, 1);
    c.dispose();
  });

  test('a failed registration is retried at the next change', () async {
    devices.fail = true;
    final c = coordinator();
    auth.set(
      const AppUser(uid: 'u1', email: 'a@b.c', providerIds: ['password']),
    );
    await c.syncDevice();
    expect(devices.registered, isEmpty);
    devices.fail = false;
    await c.syncDevice();
    expect(devices.registered, [('token-1', 'ios')]);
  });

  test('ensurePermission asks once and records it', () async {
    final c = coordinator();
    expect(await c.ensurePermission(), isTrue);
    expect(push.asked, isTrue);
    expect(notifications.permissionAsked, isTrue);
    push.asked = false;
    expect(await c.ensurePermission(), isTrue);
    expect(push.asked, isFalse);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('notify_permission_asked'), isTrue);
  });
}
