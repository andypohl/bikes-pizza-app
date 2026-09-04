/// The three content feeds surfaced by the bottom navigation bar.
enum PostFeed {
  blog(label: 'Blog', feeds: []),
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

  /// Values of the posts' `feed` field that make up this tab. Empty means
  /// "every post".
  final List<String> feeds;

  bool get isFiltered => feeds.isNotEmpty;
}
