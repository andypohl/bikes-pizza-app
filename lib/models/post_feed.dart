/// The three content feeds surfaced by the bottom navigation bar.
enum PostFeed {
  blog(label: 'Blog', tagSlugs: []),
  pizza(label: 'Pizza', tagSlugs: ['pizza'], submitLabel: 'Submit Pizza'),
  bikes(
    label: 'Bikes',
    tagSlugs: ['biking', 'off-road-biking'],
    submitLabel: 'Submit Bike',
  );

  const PostFeed({
    required this.label,
    required this.tagSlugs,
    this.submitLabel,
  });

  final String label;

  /// Label of the member submission button shown under this feed's list, or
  /// null when the feed takes no submissions.
  final String? submitLabel;

  /// Ghost tag slugs that make up this feed. Empty means "every post".
  final List<String> tagSlugs;

  bool get isFiltered => tagSlugs.isNotEmpty;
}
