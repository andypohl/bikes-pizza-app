import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/post_repository.dart';
import '../models/post.dart';
import '../models/post_feed.dart';

/// Which posts the reader has not opened since they were published or last
/// edited, per feed, for the counters on the tabs and the app's icon badge.
///
/// A post counts as unread when it changed after the [baseline] and has not
/// been marked read since that change. The baseline starts at the moment
/// this device first ran the app (nothing older is ever unread) and moves
/// forward whenever everything before some point has been read, so the
/// changes fetched from Firestore stay few. Marks are kept only for posts
/// still after the baseline. Everything is persisted with
/// shared_preferences.
class UnreadTracker extends ChangeNotifier {
  UnreadTracker({
    DateTime? baseline,
    Map<String, DateTime>? marks,
    this.badgeAsked = false,
  }) : _baseline = baseline ?? DateTime.now(),
       _marks = {...?marks};

  static const _key = 'unread_posts';

  DateTime _baseline;
  final Map<String, DateTime> _marks;
  List<PostChange> _changes = const [];
  Map<String, int> _counts = const {};

  /// Whether the badge permission has been asked for on this device.
  bool badgeAsked;

  DateTime get baseline => _baseline;

  /// Restores the state saved on this device, or starts fresh with the
  /// baseline at now.
  static Future<UnreadTracker> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_key);
      if (saved != null) {
        final json = jsonDecode(saved) as Map<String, dynamic>;
        final marks = json['marks'];
        return UnreadTracker(
          baseline: DateTime.tryParse(json['baseline'] as String? ?? ''),
          marks: {
            if (marks is Map)
              for (final e in marks.entries)
                if (e.value is String &&
                    DateTime.tryParse(e.value as String) != null)
                  e.key as String: DateTime.parse(e.value as String),
          },
          badgeAsked: json['badgeAsked'] == true,
        );
      }
    } on Object {
      // Start fresh.
    }
    final tracker = UnreadTracker();
    await tracker._save();
    return tracker;
  }

  Future<void> _save() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _key,
        jsonEncode({
          'baseline': _baseline.toUtc().toIso8601String(),
          'marks': {
            for (final e in _marks.entries)
              e.key: e.value.toUtc().toIso8601String(),
          },
          'badgeAsked': badgeAsked,
        }),
      );
    } on Object {
      // Best effort; the in-memory state is what the screens show.
    }
  }

  bool _isUnread(String id, DateTime changedAt) {
    if (!changedAt.isAfter(_baseline)) return false;
    final mark = _marks[id];
    return mark == null || mark.isBefore(changedAt);
  }

  /// Whether [post] has not been opened since it was published or edited.
  bool isUnread(Post post) => _isUnread(post.id, post.changedAt);

  /// How many unread posts a tab has.
  int unreadCount(PostFeed feed) =>
      feed.feeds.fold(0, (sum, f) => sum + (_counts[f] ?? 0));

  /// Every unread post, across the feeds: the app icon's badge.
  int get total => _counts.values.fold(0, (sum, n) => sum + n);

  void _recount() {
    final counts = <String, int>{};
    for (final change in _changes) {
      if (_isUnread(change.id, change.changedAt)) {
        counts[change.feed] = (counts[change.feed] ?? 0) + 1;
      }
    }
    _counts = counts;
  }

  /// Fetches what changed since the baseline and recounts. Errors are
  /// swallowed: the counters keep their last values.
  Future<void> refresh(PostRepository repository) async {
    final List<PostChange> changes;
    try {
      changes = await repository.fetchChanges(since: _baseline);
    } on Object {
      return;
    }
    _changes = changes;
    _recount();
    // Move the baseline up to the oldest unread change (a hair before it,
    // as the query is strictly "after"), or past everything when all is
    // read, and forget marks that fell behind it.
    DateTime? oldestUnread;
    DateTime? newest;
    for (final change in changes) {
      if (newest == null || change.changedAt.isAfter(newest)) {
        newest = change.changedAt;
      }
      if (_isUnread(change.id, change.changedAt) &&
          (oldestUnread == null || change.changedAt.isBefore(oldestUnread))) {
        oldestUnread = change.changedAt;
      }
    }
    if (oldestUnread != null) {
      _baseline = oldestUnread.subtract(const Duration(milliseconds: 1));
    } else if (newest != null && newest.isAfter(_baseline)) {
      _baseline = newest;
    }
    final kept = {for (final c in changes) c.id};
    _marks.removeWhere(
      (id, at) => !kept.contains(id) || !at.isAfter(_baseline),
    );
    await _save();
    notifyListeners();
  }

  /// Records that [post] was opened as it now reads.
  Future<void> markRead(Post post) async {
    if (!isUnread(post)) return;
    _marks[post.id] = post.changedAt;
    _recount();
    notifyListeners();
    await _save();
  }

  /// Remembers that the badge permission was asked for.
  Future<void> setBadgeAsked() async {
    badgeAsked = true;
    await _save();
  }
}
