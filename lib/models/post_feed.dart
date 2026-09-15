import '../contract.dart';

/// "Bike", "Pizza", "News post": the feed's noun with a capital, for
/// labels that name one post.
String feedNounLabel(String feed) {
  final noun = feedNouns[feed] ?? feed;
  return noun.isEmpty ? noun : '${noun[0].toUpperCase()}${noun.substring(1)}';
}

/// The content tabs of the bottom navigation bar: "All" shows the gallery
/// (bikes and pizza together, as the website's front page does), the others
/// one feed each. News is written by the editors and read as full
/// articles, so it is kept out of "All" and has no submissions.
enum PostFeed {
  all(label: 'All', feeds: ['bikes', 'pizza']),
  news(label: 'News', feeds: ['news']),
  pizza(
    label: 'Pizza',
    feeds: ['pizza'],
    submitLabel: 'Submit Pizza',
    submitNoun: 'pizza',
    submitTitleHint: "(e.g. Domino's 14-inch Pepperoni)",
  ),
  bikes(
    label: 'Bikes',
    feeds: ['bikes'],
    submitLabel: 'Submit Bike',
    submitNoun: 'bike',
    submitTitleHint: '(e.g. 1991 Trek 970 mountain bike!)',
  );

  const PostFeed({
    required this.label,
    required this.feeds,
    this.submitLabel,
    this.submitNoun = 'submission',
    this.submitTitleHint,
  });

  final String label;

  /// Label of the member submission button shown under this feed's list, or
  /// null when the feed takes no submissions.
  final String? submitLabel;

  /// What the member is submitting, for messages ("your bike").
  final String submitNoun;

  /// Grey example text in the submission form's Title field.
  final String? submitTitleHint;

  /// Values of the posts' `feed` field that make up this tab.
  final List<String> feeds;
}
