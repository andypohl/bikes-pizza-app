/// The three content feeds surfaced by the bottom navigation bar.
enum PostFeed {
  blog(label: 'Blog', tagSlugs: []),
  pizza(label: 'Pizza', tagSlugs: ['pizza']),
  bikes(label: 'Bikes', tagSlugs: ['biking', 'off-road-biking']);

  const PostFeed({required this.label, required this.tagSlugs});

  final String label;

  /// Ghost tag slugs that make up this feed. Empty means "every post".
  final List<String> tagSlugs;

  bool get isFiltered => tagSlugs.isNotEmpty;
}
