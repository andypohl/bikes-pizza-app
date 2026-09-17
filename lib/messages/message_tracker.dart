import 'dart:async';

import 'package:flutter/foundation.dart';

import '../auth/auth_service.dart';
import 'thread_service.dart';

/// Follows the signed-in member's direct message threads, for the
/// Messages button's badge and the app icon's total: listens to
/// [ThreadService.threads] while a verified member is signed in, and
/// exposes the threads and how many messages are unread across them.
class MessageTracker extends ChangeNotifier {
  MessageTracker({required this.service, required this.auth}) {
    _users = auth.userChanges.listen((_) => _follow());
    _follow();
  }

  final ThreadService service;
  final AuthService auth;

  StreamSubscription<AppUser?>? _users;
  StreamSubscription<List<Thread>>? _threads;
  String? _following;
  List<Thread> _list = const [];

  /// The member's threads, newest message first; empty when signed out.
  List<Thread> get threads => _list;

  /// Unread messages across every thread.
  int get unread => _list.fold(0, (sum, t) => sum + t.unread);

  void _follow() {
    final user = auth.currentUser;
    final uid = user != null && user.emailVerified ? user.uid : null;
    if (uid == _following) return;
    _following = uid;
    _threads?.cancel();
    _threads = null;
    if (uid == null) {
      if (_list.isNotEmpty) {
        _list = const [];
        notifyListeners();
      }
      return;
    }
    _threads = service.threads().listen(
      (threads) {
        _list = [
          for (final t in threads)
            if (!t.gone) t,
        ];
        notifyListeners();
      },
      onError: (_) {
        // The last list stands; the screens show it as it was.
      },
    );
  }

  @override
  void dispose() {
    _users?.cancel();
    _threads?.cancel();
    super.dispose();
  }
}
