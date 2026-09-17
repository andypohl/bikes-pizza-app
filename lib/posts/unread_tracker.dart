import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/post_repository.dart';
import '../models/post.dart';
import '../models/post_feed.dart';
import 'comment_service.dart';

/// Which posts the reader has not opened since they were published, last
/// edited or mentioned them in a comment, per feed, for the counters on
/// the tabs and the app's icon badge; and how many comments on a post
/// they have not seen, for the "N new" on its tile.
///
/// A post counts as unread when it changed after the [baseline] and has
/// not been marked read since that change; a mention notice counts as a
/// change of the post at the notice's time. The baseline starts at the
/// moment this device first ran the app (nothing older is ever unread)
/// and moves forward whenever everything before some point has been
/// read and seen, so the changes fetched from Firestore stay few. Marks
/// and the times posts were opened are kept only for posts still after
/// the baseline. Everything is persisted with shared_preferences.
class UnreadTracker extends ChangeNotifier {
  UnreadTracker({
    DateTime? baseline,
    Map<String, DateTime>? marks,
    Map<String, DateTime>? opened,
    this.badgeAsked = false,
    DateTime Function()? now,
  }) : _baseline = baseline ?? DateTime.now(),
       _marks = {...?marks},
       _opened = {...?opened},
       _now = now ?? DateTime.now;

  static const _key = 'unread_posts';

  DateTime _baseline;
  final Map<String, DateTime> _marks;

  /// When each post was last opened on this device; comments written
  /// after that are unseen.
  final Map<String, DateTime> _opened;

  /// The newest mention of the member on each post, from the notices.
  Map<String, DateTime> _mentions = const {};
  List<PostChange> _changes = const [];
  Map<String, int> _counts = const {};
  final DateTime Function() _now;

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
        return UnreadTracker(
          baseline: DateTime.tryParse(json['baseline'] as String? ?? ''),
          marks: _times(json['marks']),
          opened: _times(json['opened']),
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

  static Map<String, DateTime> _times(Object? json) => {
    if (json is Map)
      for (final e in json.entries)
        if (e.value is String && DateTime.tryParse(e.value as String) != null)
          e.key as String: DateTime.parse(e.value as String),
  };

  static Map<String, String> _iso(Map<String, DateTime> times) => {
    for (final e in times.entries) e.key: e.value.toUtc().toIso8601String(),
  };

  Future<void> _save() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _key,
        jsonEncode({
          'baseline': _baseline.toUtc().toIso8601String(),
          'marks': _iso(_marks),
          'opened': _iso(_opened),
          'badgeAsked': badgeAsked,
        }),
      );
    } on Object {
      // Best effort; the in-memory state is what the screens show.
    }
  }

  /// When the post last changed for this member: its edit time, or the
  /// newest mention of them on it if that is later.
  DateTime _effective(String id, DateTime changedAt) {
    final mention = _mentions[id];
    return mention != null && mention.isAfter(changedAt) ? mention : changedAt;
  }

  bool _isUnread(String id, DateTime changedAt) {
    if (!changedAt.isAfter(_baseline)) return false;
    final mark = _marks[id];
    return mark == null || mark.isBefore(changedAt);
  }

  /// Whether [post] has not been opened since it was published, edited
  /// or the member was mentioned on it.
  bool isUnread(Post post) =>
      _isUnread(post.id, _effective(post.id, post.changedAt));

  /// The time comments on [id] were last seen: when it was last opened
  /// on this device, or the baseline if never.
  DateTime _seenAt(String id) {
    final opened = _opened[id];
    return opened != null && opened.isAfter(_baseline) ? opened : _baseline;
  }

  /// How many of [times] (a post's newest comment times) are unseen.
  int _unseen(String id, List<DateTime> times) {
    final seen = _seenAt(id);
    return times.where((t) => t.isAfter(seen)).length;
  }

  /// How many comments on [post] were written since it was last opened
  /// here; the post carries only its newest twenty times, so the count
  /// stops there (see [unseenLabel]).
  int unseenComments(Post post) => _unseen(post.id, post.commentTimes);

  /// "3 new", or "20+ new" when every carried time is unseen; null when
  /// nothing is.
  String? unseenLabel(Post post) {
    final n = unseenComments(post);
    if (n == 0) return null;
    return n >= post.commentTimes.length && post.commentTimes.isNotEmpty
        ? '$n+ new'
        : '$n new';
  }

  /// How many unread posts a tab has.
  int unreadCount(PostFeed feed) =>
      feed.feeds.fold(0, (sum, f) => sum + (_counts[f] ?? 0));

  /// Every unread post, across the feeds: the app icon's badge.
  int get total => _counts.values.fold(0, (sum, n) => sum + n);

  void _recount() {
    final counts = <String, int>{};
    for (final change in _changes) {
      if (_isUnread(change.id, _effective(change.id, change.changedAt))) {
        counts[change.feed] = (counts[change.feed] ?? 0) + 1;
      }
    }
    _counts = counts;
  }

  /// Fetches what changed since the baseline (and, with [notices], the
  /// member's mention notices since then) and recounts. Errors are
  /// swallowed: the counters keep their last values.
  Future<void> refresh(
    PostRepository repository, {
    Future<List<Notice>> Function(DateTime since)? notices,
  }) async {
    final List<PostChange> changes;
    try {
      changes = await repository.fetchChanges(since: _baseline);
    } on Object {
      return;
    }
    if (notices != null) {
      try {
        final mentions = <String, DateTime>{};
        for (final notice in await notices(_baseline)) {
          final at = mentions[notice.post];
          if (at == null || notice.at.isAfter(at)) {
            mentions[notice.post] = notice.at;
          }
        }
        _mentions = mentions;
      } on Object {
        // The mentions seen last time stand.
      }
    } else {
      _mentions = const {};
    }
    _changes = changes;
    _recount();
    // Move the baseline up to the oldest thing still unread or unseen (a
    // hair before it, as the query is strictly "after"), or past
    // everything when all is read, and forget marks and open times that
    // fell behind it.
    DateTime? oldest;
    DateTime? newest;
    void hold(DateTime at) {
      final o = oldest;
      if (o == null || at.isBefore(o)) oldest = at;
    }

    for (final change in changes) {
      final at = _effective(change.id, change.changedAt);
      for (final t in [at, ?change.commentedAt]) {
        final n = newest;
        if (n == null || t.isAfter(n)) newest = t;
      }
      if (_isUnread(change.id, at)) hold(at);
      final seen = _seenAt(change.id);
      for (final t in change.commentTimes) {
        if (t.isAfter(seen)) hold(t);
      }
    }
    final o = oldest;
    final n = newest;
    if (o != null) {
      _baseline = o.subtract(const Duration(milliseconds: 1));
    } else if (n != null && n.isAfter(_baseline)) {
      _baseline = n;
    }
    final kept = {for (final c in changes) c.id};
    _marks.removeWhere(
      (id, at) => !kept.contains(id) || !at.isAfter(_baseline),
    );
    _opened.removeWhere(
      (id, at) => !kept.contains(id) || !at.isAfter(_baseline),
    );
    await _save();
    notifyListeners();
  }

  /// Records that [post] was opened as it now reads: it is read, and its
  /// comments so far are seen.
  Future<void> markRead(Post post) async {
    final at = _effective(post.id, post.changedAt);
    final unread = _isUnread(post.id, at);
    final unseen = unseenComments(post) > 0;
    if (unread) _marks[post.id] = at;
    _opened[post.id] = _now();
    if (!unread && !unseen) return;
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
