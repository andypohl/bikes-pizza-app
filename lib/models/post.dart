/// A single blog post, normalised from either the Ghost Content API or the
/// site's RSS feed so the UI never has to care where it came from.
class Post {
  const Post({
    required this.id,
    required this.title,
    required this.url,
    required this.publishedAt,
    this.excerpt = '',
    this.html = '',
    this.featureImage,
    this.tags = const [],
  });

  final String id;
  final String title;

  /// Canonical URL of the post on the website.
  final String url;
  final DateTime publishedAt;

  /// Plain-text summary, safe to show in a list.
  final String excerpt;

  /// Full post body as HTML.
  final String html;

  /// Thumbnail / hero image URL, if the post has one.
  final String? featureImage;

  /// Tag slugs, e.g. `pizza`, `off-road-biking`.
  final List<String> tags;

  bool hasTag(String slug) => tags.contains(slug);

  factory Post.fromGhostJson(Map<String, dynamic> json) {
    final rawTags = json['tags'];
    final tags = rawTags is List
        ? rawTags
            .whereType<Map<String, dynamic>>()
            .map((t) => t['slug'])
            .whereType<String>()
            .toList(growable: false)
        : const <String>[];

    return Post(
      id: json['id'] as String? ?? json['uuid'] as String? ?? '',
      title: json['title'] as String? ?? '(untitled)',
      url: json['url'] as String? ?? '',
      publishedAt: DateTime.tryParse(json['published_at'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      excerpt: (json['custom_excerpt'] as String?)?.trim().isNotEmpty == true
          ? (json['custom_excerpt'] as String).trim()
          : (json['excerpt'] as String? ?? '').trim(),
      html: json['html'] as String? ?? '',
      featureImage: json['feature_image'] as String?,
      tags: tags,
    );
  }

  @override
  String toString() => 'Post($id, "$title")';
}
