import '../data/portable_text_html.dart';
import 'bike_options.dart';

/// The member who submitted a post: their Sanity `member` document id
/// (stable, used to list their posts) and current username.
class PostAuthor {
  const PostAuthor({required this.id, required this.username});

  final String id;
  final String username;
}

/// One labelled bike detail ready to display, e.g. `Type: MTB`.
class BikeSpec {
  const BikeSpec(this.label, this.value);

  final String label;
  final String value;
}

/// The structured details of a bike post, as stored (option values), with
/// the display forms the app shows.
class BikeDetails {
  const BikeDetails({this.brand, this.year, this.color, this.type});

  final String? brand;
  final String? year;
  final String? color;
  final String? type;

  bool get isEmpty =>
      _blank(brand) && _blank(year) && _blank(color) && _blank(type);

  String? get yearTitle => _title(bikeYears, year);
  String? get colorTitle => _title(bikeColors, color);
  String? get typeTitle => _title(bikeTypes, type);

  /// The filled-in details in display order.
  List<BikeSpec> get specs => [
    if (!_blank(brand)) BikeSpec('Brand', brand!.trim()),
    if (yearTitle != null) BikeSpec('Year', yearTitle!),
    if (colorTitle != null) BikeSpec('Color', colorTitle!),
    if (typeTitle != null) BikeSpec('Type', typeTitle!),
  ];

  /// One line for lists: brand, type and year, e.g. `GT · MTB · 1990s`.
  String? get line {
    final parts = [if (!_blank(brand)) brand!.trim(), ?typeTitle, ?yearTitle];
    return parts.isEmpty ? null : parts.join(' · ');
  }

  static bool _blank(String? value) => value == null || value.trim().isEmpty;

  static String? _title(Map<String, String> titles, String? value) =>
      _blank(value) ? null : titles[value] ?? value;

  factory BikeDetails.fromJson(Map<dynamic, dynamic> json) => BikeDetails(
    brand: json['brand'] as String?,
    year: json['year'] as String?,
    color: json['color'] as String?,
    type: json['type'] as String?,
  );
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
    this.bike,
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

  /// Structured details of a bike post, when some have been filled in.
  final BikeDetails? bike;

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
    final rawBike = json['bike'];
    final bike = rawBike is Map && feed == 'bikes'
        ? BikeDetails.fromJson(rawBike)
        : null;

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
      bike: bike == null || bike.isEmpty ? null : bike,
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
