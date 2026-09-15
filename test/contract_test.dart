import 'package:bikes_pizza/contract.dart';
import 'package:bikes_pizza/models/post_feed.dart';
import 'package:flutter_test/flutter_test.dart';

// The app's PostFeed enum is hand-written (enum values must be), so this
// keeps it in step with the generated contract.
void main() {
  test('every feed the contract knows has a tab, and only those', () {
    final tabs = {
      for (final f in PostFeed.values)
        if (f != PostFeed.all) f.feeds.single: f,
    };
    expect(tabs.keys.toSet(), feedLabels.keys.toSet());
    for (final entry in tabs.entries) {
      expect(entry.value.label, feedLabels[entry.key]);
      expect(
        entry.value.submitLabel != null,
        submissionFeeds.contains(entry.key),
      );
      if (entry.value.submitLabel != null) {
        expect(entry.value.submitNoun, feedNouns[entry.key]);
      }
    }
    expect(PostFeed.all.feeds, galleryFeeds);
  });

  test('post paths follow the contract', () {
    expect(postPath('news', 'welcome'), '/news/welcome/');
    expect(postPath('bikes', 'trek-970'), '/post/trek-970/');
    expect(postPath('pizza', 'slice'), '/post/slice/');
  });

  test('feed nouns make labels', () {
    expect(feedNounLabel('bikes'), 'Bike');
    expect(feedNounLabel('news'), 'News post');
    expect(feedNounLabel('other'), 'Other');
  });
}
