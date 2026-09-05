import '../data/portable_text_html.dart';

/// The member who submitted a post: their Sanity `member` document id
/// (stable, used to list their posts) and current username.
class PostAuthor {
  const PostAuthor({required this.id, required this.username});

  final String id;
  final String username;
}

/// A single post as loaded from Sanity.
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
    this.submittedBy,
    this.author,
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

  /// Feed values the post belongs to, e.g. `pizza`, `bikes`.
  final List<String> tags;

  /// The credit typed when the post was submitted, if any.
  final String? submittedBy;

  /// The submitting member, when the post carries a member reference.
  final PostAuthor? author;

  /// Who to credit: the member's current username when known, else the
  /// text typed at submission. Null for posts written in the Studio.
  String? get credit {
    final username = author?.username;
    if (username != null && username.isNotEmpty) return username;
    final typed = submittedBy?.trim();
    return typed == null || typed.isEmpty ? null : typed;
  }

  bool hasTag(String slug) => tags.contains(slug);

  /// Image transformation parameters for Sanity's image CDN.
  static const _imageParams = 'w=1200&auto=format&q=80';

  /// Builds a post from the projection `SanityPostRepository` requests.
  factory Post.fromSanityJson(
    Map<String, dynamic> json, {
    required String siteUrl,
  }) {
    final slug = json['slug'] as String? ?? '';
    final feed = json['feed'] as String?;
    final rawBody = json['body'];
    final body = rawBody is List ? rawBody : const <dynamic>[];
    final image = json['image'] as String?;
    final custom = (json['excerpt'] as String?)?.trim() ?? '';
    final rawAuthor = json['author'];
    final authorId = rawAuthor is Map ? rawAuthor['id'] as String? : null;

    return Post(
      id: slug.isNotEmpty ? slug : json['_id'] as String? ?? '',
      title: json['title'] as String? ?? '(untitled)',
      url: slug.isEmpty ? '' : '$siteUrl/post/$slug/',
      publishedAt:
          DateTime.tryParse(json['publishedAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      excerpt: custom.isNotEmpty
          ? custom
          : summarize(json['plain'] as String? ?? ''),
      html: portableTextToHtml(body),
      featureImage: image == null || image.isEmpty
          ? null
          : '$image?$_imageParams',
      tags: feed == null || feed.isEmpty ? const [] : [feed],
      submittedBy: json['submittedBy'] as String?,
      author: authorId == null
          ? null
          : PostAuthor(
              id: authorId,
              username: (rawAuthor as Map)['username'] as String? ?? '',
            ),
    );
  }

  /// Shortens plain text to one line of at most [max] characters.
  static String summarize(String text, {int max = 200}) {
    final flat = text.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (flat.length <= max) return flat;
    return '${flat.substring(0, max - 1).trimRight()}…';
  }

  @override
  String toString() => 'Post($id, "$title")';
}
