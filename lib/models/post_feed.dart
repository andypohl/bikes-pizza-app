/// The three content feeds surfaced by the bottom navigation bar.
enum PostFeed {
  blog(label: 'Blog', tagSlugs: []),
  pizza(
    label: 'Pizza',
    tagSlugs: ['pizza'],
    submitLabel: 'Submit Pizza',
    submitNoun: 'pizza',
    submitTitleHint: "(e.g. Domino's 14-inch Pepperoni)",
  ),
  bikes(
    label: 'Bikes',
    tagSlugs: ['biking', 'off-road-biking'],
    submitLabel: 'Submit Bike',
    submitNoun: 'bike',
    submitTitleHint: '(e.g. 1991 Trek 970 mountain bike!)',
  );

  const PostFeed({
    required this.label,
    required this.tagSlugs,
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

  /// Ghost tag slugs that make up this feed. Empty means "every post".
  final List<String> tagSlugs;

  bool get isFiltered => tagSlugs.isNotEmpty;
}
