import 'package:bikes_pizza/data/post_repository.dart';
import 'package:bikes_pizza/models/post.dart';
import 'package:bikes_pizza/models/post_feed.dart';
import 'package:bikes_pizza/posts/comment_service.dart';
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
    // As the repository does: changed or commented on after `since`.
    return [
      for (final c in changes)
        if (c.changedAt.isAfter(since) ||
            (c.commentedAt?.isAfter(since) ?? false))
          c,
    ];
  }

  @override
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1, String? uid}) =>
      throw UnimplementedError();

  @override
  Future<Post?> fetchPost(String id) => throw UnimplementedError();
}

PostChange _change(
  String id,
  String feed,
  int day, {
  List<int> comments = const [],
}) => PostChange(
  id: id,
  feed: feed,
  changedAt: DateTime.utc(2026, 9, day),
  commentedAt: comments.isEmpty ? null : DateTime.utc(2026, 9, comments.first),
  commentTimes: [for (final d in comments) DateTime.utc(2026, 9, d)],
);

Post _post(String id, String feed, int day, {List<int> comments = const []}) =>
    Post(
      id: id,
      feed: feed,
      title: id,
      url: '',
      publishedAt: DateTime.utc(2026, 9, day),
      commentCount: comments.length,
      commentTimes: [for (final d in comments) DateTime.utc(2026, 9, d)],
    );

Notice _mention(String post, int day) => Notice(
  id: '$post-$day',
  kind: 'mention',
  post: post,
  at: DateTime.utc(2026, 9, day),
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

  test(
    'a mention makes a read post unread again, on its tab and the badge',
    () async {
      final tracker = UnreadTracker(baseline: DateTime.utc(2026, 9, 1));
      final repo = _Changes([
        _change('b1', 'bikes', 2, comments: [8]),
      ]);
      await tracker.refresh(repo);
      await tracker.markRead(_post('b1', 'bikes', 2));
      expect(tracker.total, 0);

      // The comment that mentioned the member was published on the 8th;
      // the post is in the changes through its commentedAt.
      var notices = [_mention('b1', 8)];
      await tracker.refresh(repo, notices: (since) async => notices);
      expect(tracker.isUnread(_post('b1', 'bikes', 2)), isTrue);
      expect(tracker.unreadCount(PostFeed.bikes), 1);
      expect(tracker.total, 1);
      expect(
        tracker.baseline,
        DateTime.utc(2026, 9, 8).subtract(const Duration(milliseconds: 1)),
      );

      // Opening the post clears it; the same mention does not come back.
      await tracker.markRead(_post('b1', 'bikes', 2));
      expect(tracker.isUnread(_post('b1', 'bikes', 2)), isFalse);
      expect(tracker.total, 0);
      await tracker.refresh(repo, notices: (since) async => notices);
      expect(tracker.total, 0);

      // A later mention (with the comment that made it): unread again. A
      // failed notices fetch keeps the mentions seen last time.
      notices = [_mention('b1', 8), _mention('b1', 9)];
      repo.changes = [
        _change('b1', 'bikes', 2, comments: [9, 8]),
      ];
      await tracker.refresh(repo, notices: (since) async => notices);
      expect(tracker.total, 1);
      await tracker.refresh(repo, notices: (since) => throw Exception('down'));
      expect(tracker.total, 1);
      // Signed out: no mentions count.
      await tracker.refresh(repo);
      expect(tracker.total, 0);
    },
  );

  test('unseen comments are counted from the last opening, without a dot', () async {
    var now = DateTime.utc(2026, 9, 3);
    final tracker = UnreadTracker(
      baseline: DateTime.utc(2026, 9, 1),
      now: () => now,
    );
    final repo = _Changes([
      _change('p1', 'pizza', 2, comments: [6, 5, 4]),
    ]);
    await tracker.refresh(repo);
    // Published on the 2nd, never opened: the dot, and every comment new.
    final post = _post('p1', 'pizza', 2, comments: [6, 5, 4]);
    expect(tracker.isUnread(post), isTrue);
    expect(tracker.unseenComments(post), 3);
    expect(tracker.unseenLabel(post), '3+ new');

    // Opened on the 5th at noon: read, and one comment (the 6th) unseen.
    now = DateTime.utc(2026, 9, 5, 12);
    await tracker.markRead(post);
    expect(tracker.isUnread(post), isFalse);
    expect(tracker.total, 0);
    expect(tracker.unseenComments(post), 1);
    expect(tracker.unseenLabel(post), '1 new');
    // The baseline holds before the unseen comment.
    await tracker.refresh(repo);
    expect(
      tracker.baseline,
      DateTime.utc(2026, 9, 6).subtract(const Duration(milliseconds: 1)),
    );

    // Opened again on the 7th: nothing new; the baseline passes everything.
    now = DateTime.utc(2026, 9, 7);
    var notified = 0;
    tracker.addListener(() => notified++);
    await tracker.markRead(post);
    expect(notified, 1);
    expect(tracker.unseenLabel(post), isNull);
    await tracker.refresh(repo);
    expect(tracker.baseline, DateTime.utc(2026, 9, 6));
    await tracker.markRead(post); // nothing to do
    expect(notified, 2); // refresh notified once more; markRead did not

    // A post from before the baseline never shows new comments from before it.
    final old = _post('old', 'pizza', 1, comments: [1]);
    expect(tracker.unseenLabel(old), isNull);
  });

  test('the opening times are saved and restored', () async {
    var now = DateTime.utc(2026, 9, 5);
    final tracker = UnreadTracker(
      baseline: DateTime.utc(2026, 9, 1),
      now: () => now,
    );
    final repo = _Changes([
      _change('p1', 'pizza', 2, comments: [7, 4]),
    ]);
    await tracker.refresh(repo);
    await tracker.markRead(_post('p1', 'pizza', 2, comments: [7, 4]));
    final restored = await UnreadTracker.load();
    expect(restored.baseline, tracker.baseline);
    expect(
      restored.unseenComments(_post('p1', 'pizza', 2, comments: [7, 4])),
      1,
    );
  });
}
