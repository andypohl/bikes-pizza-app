import 'package:bikes_pizza/data/post_repository.dart';
import 'package:bikes_pizza/models/post.dart';
import 'package:bikes_pizza/models/post_feed.dart';
import 'package:bikes_pizza/posts/unread_tracker.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Serves a fixed list of changes; records what it was asked for.
class _Changes implements PostRepository {
  _Changes(this.changes);

  List<PostChange> changes;
  final asked = <DateTime>[];
  bool fail = false;

  @override
  Future<List<PostChange>> fetchChanges({required DateTime since}) async {
    asked.add(since);
    if (fail) throw PostFetchException('down');
    return [
      for (final c in changes)
        if (c.changedAt.isAfter(since)) c,
    ];
  }

  @override
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1, String? uid}) =>
      throw UnimplementedError();
}

PostChange _change(String id, String feed, int day) =>
    PostChange(id: id, feed: feed, changedAt: DateTime.utc(2026, 9, day));

Post _post(String id, String feed, int day) => Post(
  id: id,
  feed: feed,
  title: id,
  url: '',
  publishedAt: DateTime.utc(2026, 9, day),
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test(
    'counts posts changed after the baseline that were not opened',
    () async {
      final tracker = UnreadTracker(baseline: DateTime.utc(2026, 9, 2));
      final repo = _Changes([
        _change('old', 'bikes', 1),
        _change('b1', 'bikes', 3),
        _change('p1', 'pizza', 4),
        _change('n1', 'news', 5),
      ]);
      await tracker.refresh(repo);
      expect(tracker.unreadCount(PostFeed.bikes), 1);
      expect(tracker.unreadCount(PostFeed.pizza), 1);
      expect(tracker.unreadCount(PostFeed.news), 1);
      expect(tracker.unreadCount(PostFeed.all), 2);
      expect(tracker.total, 3);
      expect(tracker.isUnread(_post('b1', 'bikes', 3)), isTrue);
      expect(tracker.isUnread(_post('old', 'bikes', 1)), isFalse);

      var notified = 0;
      tracker.addListener(() => notified++);
      await tracker.markRead(_post('b1', 'bikes', 3));
      expect(tracker.isUnread(_post('b1', 'bikes', 3)), isFalse);
      expect(tracker.unreadCount(PostFeed.bikes), 0);
      expect(tracker.total, 2);
      expect(notified, 1);
      await tracker.markRead(_post('b1', 'bikes', 3)); // already read
      expect(notified, 1);

      // Edited later: unread again.
      expect(tracker.isUnread(_post('b1', 'bikes', 9)), isTrue);
    },
  );

  test('the baseline moves up to the oldest unread change, and marks are pruned', () async {
    final tracker = UnreadTracker(baseline: DateTime.utc(2026, 9, 1));
    final repo = _Changes([
      _change('a', 'bikes', 2),
      _change('b', 'pizza', 3),
      _change('c', 'news', 4),
    ]);
    await tracker.refresh(repo);
    expect(
      tracker.baseline,
      DateTime.utc(2026, 9, 2).subtract(const Duration(milliseconds: 1)),
    );

    await tracker.markRead(_post('a', 'bikes', 2));
    await tracker.refresh(repo);
    // "a" is read, so the baseline passes it, and its mark is no longer needed.
    expect(
      tracker.baseline,
      DateTime.utc(2026, 9, 3).subtract(const Duration(milliseconds: 1)),
    );
    expect(
      repo.asked.last,
      DateTime.utc(2026, 9, 2).subtract(const Duration(milliseconds: 1)),
    );
    expect(tracker.total, 2);

    await tracker.markRead(_post('b', 'pizza', 3));
    await tracker.markRead(_post('c', 'news', 4));
    await tracker.refresh(repo);
    expect(
      tracker.baseline,
      DateTime.utc(2026, 9, 4),
      reason: 'everything read: past the newest change',
    );
    expect(tracker.total, 0);
    await tracker.refresh(repo);
    expect(tracker.total, 0);
  });

  test('a failed refresh keeps the last counts', () async {
    final tracker = UnreadTracker(baseline: DateTime.utc(2026, 9, 1));
    final repo = _Changes([_change('a', 'bikes', 2)]);
    await tracker.refresh(repo);
    expect(tracker.total, 1);
    repo.fail = true;
    await tracker.refresh(repo);
    expect(tracker.total, 1);
  });

  test(
    'load starts fresh with the baseline at now, then restores what was saved',
    () async {
      final before = DateTime.now();
      final fresh = await UnreadTracker.load();
      expect(fresh.baseline.isBefore(before), isFalse);
      expect(fresh.badgeAsked, isFalse);

      final repo = _Changes([_change('a', 'bikes', 30)]);
      await fresh.refresh(repo);
      await fresh.markRead(_post('a', 'bikes', 30));
      await fresh.setBadgeAsked();

      final restored = await UnreadTracker.load();
      expect(restored.baseline, fresh.baseline);
      expect(restored.badgeAsked, isTrue);
      expect(restored.isUnread(_post('a', 'bikes', 30)), isFalse);
      expect(restored.isUnread(_post('z', 'bikes', 30)), isTrue);
    },
  );
}
