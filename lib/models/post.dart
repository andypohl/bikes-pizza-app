import '../contract.dart';

/// A post's photo: where its renditions live and which sizes exist. The
/// functions make them when a post is published (functions/renditions.js);
/// `base` is the URL prefix a rendition's file name is appended to.
class PostImage {
  const PostImage({
    required this.base,
    required this.width,
    required this.height,
    required this.sizes,
    this.blur,
    this.focusX = 0.5,
    this.focusY = 0.5,
  });

  final String base;

  /// Of the original, after rotation.
  final int width;
  final int height;

  /// Widths of the renditions, smallest first.
  final List<int> sizes;

  /// A tiny data: URL of the photo, for a placeholder.
  final String? blur;

  /// Where the subject is, 0..1 from the top left.
  final double focusX;
  final double focusY;

  /// Width over height; lets the photo be laid out before it arrives.
  double get aspectRatio => width > 0 && height > 0 ? width / height : 16 / 9;

  /// The rendition that fits a slot [maxWidth] pixels wide: the widest no
  /// wider than that, else the smallest there is.
  String url(int maxWidth, {String format = 'webp'}) {
    var chosen = sizes.first;
    for (final size in sizes) {
      if (size <= maxWidth) chosen = size;
    }
    return _rendition('$chosen.$format');
  }

  /// The widest rendition.
  String get largestUrl => _rendition('${sizes.last}.webp');

  String _rendition(String name) =>
      '$base${Uri.encodeComponent(name)}?alt=media';

  /// Null unless [json] describes a photo with at least one rendition.
  static PostImage? fromJson(Object? json) {
    if (json is! Map) return null;
    final base = json['base'];
    final rawSizes = json['sizes'];
    final sizes = rawSizes is List
        ? rawSizes.whereType<num>().map((n) => n.toInt()).toList()
        : const <int>[];
    if (base is! String || base.isEmpty || sizes.isEmpty) return null;
    final focus = json['focus'];
    return PostImage(
      base: base,
      width: (json['width'] as num?)?.toInt() ?? 0,
      height: (json['height'] as num?)?.toInt() ?? 0,
      sizes: sizes,
      blur: json['blur'] as String?,
      focusX: focus is Map ? (focus['x'] as num?)?.toDouble() ?? 0.5 : 0.5,
      focusY: focus is Map ? (focus['y'] as num?)?.toDouble() ?? 0.5 : 0.5,
    );
  }
}

/// The member a post is credited to, as recorded on the post when it was
/// published: their account id, their username (empty until they choose
/// one) and the name they typed with the submission.
class PostCredit {
  const PostCredit({required this.uid, this.username = '', this.name = ''});

  final String uid;
  final String username;
  final String name;

  /// What to show: the username when there is one, else the typed name.
  String? get label {
    if (username.isNotEmpty) return username;
    final typed = name.trim();
    return typed.isEmpty ? null : typed;
  }

  static PostCredit? fromJson(Object? json) {
    if (json is! Map) return null;
    final uid = json['uid'];
    if (uid is! String || uid.isEmpty) return null;
    return PostCredit(
      uid: uid,
      username: json['username'] as String? ?? '',
      name: json['name'] as String? ?? '',
    );
  }
}

/// One labelled bike detail ready to display, e.g. `Type: Mountain`.
class BikeSpec {
  const BikeSpec(this.label, this.value);

  final String label;
  final String value;
}

/// Structured details of a post, ready to display: labelled rows for the
/// post screen and a one-liner for lists.
abstract class PostDetails {
  List<BikeSpec> get specs;
  String? get line;
}

/// The structured details of a pizza post: its style.
class PizzaDetails implements PostDetails {
  const PizzaDetails({this.style});

  final String? style;

  bool get isEmpty => style == null || style!.trim().isEmpty;

  String? get styleTitle =>
      isEmpty ? null : pizzaStyles[style] ?? style!.trim();

  @override
  List<BikeSpec> get specs => [
    if (styleTitle != null) BikeSpec('Style', styleTitle!),
  ];

  @override
  String? get line => styleTitle;

  factory PizzaDetails.fromJson(Map<dynamic, dynamic> json) =>
      PizzaDetails(style: json['style'] as String?);
}

/// The structured details of a bike post, as stored (option values), with
/// the display forms the app shows.
class BikeDetails implements PostDetails {
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
  @override
  List<BikeSpec> get specs => [
    if (!_blank(brand)) BikeSpec('Brand', brand!.trim()),
    if (yearTitle != null) BikeSpec('Year', yearTitle!),
    if (colorTitle != null) BikeSpec('Color', colorTitle!),
    if (typeTitle != null) BikeSpec('Type', typeTitle!),
  ];

  /// One line for lists: brand, type and year, e.g. `GT · Mountain · 1990s`.
  @override
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

/// A published post, as the `posts` collection holds it (the document
/// shape is described in functions/post.js).
class Post {
  const Post({
    required this.id,
    required this.feed,
    required this.title,
    required this.url,
    required this.publishedAt,
    this.summary = '',
    this.html = '',
    this.image,
    this.credit,
    this.bike,
    this.pizza,
  });

  /// The slug: the document id, the edit endpoints' id and the last part
  /// of the post's URL.
  final String id;

  /// `bikes`, `pizza` or `news`.
  final String feed;

  final String title;

  /// Canonical URL of the post on the website.
  final String url;
  final DateTime publishedAt;

  /// One line of plain text, safe to show in a list.
  final String summary;

  /// The body as HTML, rendered when the post was written.
  final String html;

  /// The photo, if the post has one (every bike and pizza does).
  final PostImage? image;

  /// The member the post is credited to, when it came from a submission.
  final PostCredit? credit;

  /// Structured details of a bike post, when some have been filled in.
  final BikeDetails? bike;

  /// Structured details of a pizza post, when filled in.
  final PizzaDetails? pizza;

  /// Whichever structured details the post has, for display.
  PostDetails? get details => bike ?? pizza;

  /// Who to credit, for display. Null for posts written by the editors.
  String? get creditLabel => credit?.label;

  /// Whether the account with [uid] is the member this post is credited to.
  bool isBy(String? uid) => uid != null && credit?.uid == uid;

  /// This post with some fields replaced, for showing an edit before the
  /// post is fetched again.
  Post copyWith({
    String? title,
    String? summary,
    String? html,
    PostImage? image,
    BikeDetails? bike,
    PizzaDetails? pizza,
    bool clearBike = false,
    bool clearPizza = false,
  }) => Post(
    id: id,
    feed: feed,
    title: title ?? this.title,
    url: url,
    publishedAt: publishedAt,
    summary: summary ?? this.summary,
    html: html ?? this.html,
    image: image ?? this.image,
    credit: credit,
    bike: clearBike ? null : bike ?? this.bike,
    pizza: clearPizza ? null : pizza ?? this.pizza,
  );

  /// Builds a post from a `posts` document (decoded from Firestore) or
  /// from the REST API's copy of one, which carries the same fields plus
  /// `url`. Without a `url` it is derived from [siteUrl].
  factory Post.fromJson(Map<String, dynamic> json, {required String siteUrl}) {
    final slug = json['slug'] as String? ?? json['id'] as String? ?? '';
    final feed = json['feed'] as String? ?? '';
    final details = json['details'];
    final bike = details is Map && feed == 'bikes'
        ? BikeDetails.fromJson(details)
        : null;
    final pizza = details is Map && feed == 'pizza'
        ? PizzaDetails.fromJson(details)
        : null;
    return Post(
      id: slug,
      feed: feed,
      title: json['title'] as String? ?? '(untitled)',
      url:
          json['url'] as String? ??
          (slug.isEmpty ? '' : '$siteUrl${postPath(feed, slug)}'),
      publishedAt:
          DateTime.tryParse(json['publishedAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      summary: json['summary'] as String? ?? '',
      html: json['html'] as String? ?? '',
      image: PostImage.fromJson(json['image']),
      credit: PostCredit.fromJson(json['credit']),
      bike: bike == null || bike.isEmpty ? null : bike,
      pizza: pizza == null || pizza.isEmpty ? null : pizza,
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
