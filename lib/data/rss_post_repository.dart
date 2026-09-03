import 'dart:io' show HttpDate;

import 'package:http/http.dart' as http;
import 'package:xml/xml.dart';

import '../models/post.dart';
import '../models/post_feed.dart';
import 'post_repository.dart';

/// Reads posts from Ghost's public RSS feeds. No API key needed, but Ghost
/// only publishes the 15 most recent posts per feed and there is no paging.
class RssPostRepository implements PostRepository {
  RssPostRepository({required this.siteUrl, http.Client? client})
    : _client = client ?? http.Client();

  final String siteUrl;
  final http.Client _client;

  @override
  String get sourceName => 'RSS feed (latest 15 posts)';

  Uri feedUri(String? tagSlug) => Uri.parse(
    tagSlug == null ? '$siteUrl/rss/' : '$siteUrl/tag/$tagSlug/rss/',
  );

  @override
  Future<PostPage> fetchPosts(PostFeed feed, {int page = 1}) async {
    // RSS has a single page; anything beyond it is empty.
    if (page > 1) return PostPage.empty;

    final uris = feed.isFiltered ? feed.tagSlugs.map(feedUri) : [feedUri(null)];

    final results = await Future.wait(uris.map(_fetchFeed));

    // Merge, de-duplicate (a post can carry more than one of the feed's
    // tags) and sort newest first.
    final byId = <String, Post>{};
    for (final posts in results) {
      for (final post in posts) {
        byId.putIfAbsent(post.id, () => post);
      }
    }
    final merged = byId.values.toList()
      ..sort((a, b) => b.publishedAt.compareTo(a.publishedAt));

    return PostPage(posts: merged, hasMore: false);
  }

  Future<List<Post>> _fetchFeed(Uri uri) async {
    final response = await _client.get(uri);
    if (response.statusCode == 404) {
      // A tag with no posts yet simply has no feed.
      return const [];
    }
    if (response.statusCode != 200) {
      throw PostFetchException('RSS feed returned HTTP ${response.statusCode}');
    }
    return parseRss(response.body);
  }

  /// Parses a Ghost RSS document into posts. Exposed for testing.
  static List<Post> parseRss(String xml) {
    final XmlDocument doc;
    try {
      doc = XmlDocument.parse(xml);
    } on XmlException catch (e) {
      throw PostFetchException('Could not parse RSS feed: ${e.message}');
    }

    return doc
        .findAllElements('item')
        .map(_postFromItem)
        .toList(growable: false);
  }

  static Post _postFromItem(XmlElement item) {
    String text(String name) => item.getElement(name)?.innerText.trim() ?? '';

    final link = text('link');
    final guid = text('guid');
    final pubDate = text('pubDate');

    final media = item
        .findElements('media:content')
        .map((e) => e.getAttribute('url'))
        .whereType<String>()
        .firstOrNull;

    final tags = item
        .findElements('category')
        .map((e) => _slugify(e.innerText))
        .where((s) => s.isNotEmpty)
        .toList(growable: false);

    return Post(
      id: guid.isNotEmpty ? guid : link,
      title: text('title').isNotEmpty ? text('title') : '(untitled)',
      url: link,
      publishedAt: _parseDate(pubDate),
      excerpt: stripHtml(text('description')),
      html: stripLeadingFeatureImage(text('content:encoded'), media),
      featureImage: media,
      tags: tags,
    );
  }

  /// Ghost prepends the feature image to `content:encoded` so RSS readers
  /// see it. The app shows that image as a hero already, so drop the
  /// duplicate when the body starts with an `<img>` pointing at it.
  static String stripLeadingFeatureImage(String html, String? featureImage) {
    if (featureImage == null || featureImage.isEmpty) return html;
    final leadingImg = RegExp(r'^\s*<img\b[^>]*>', caseSensitive: false);
    final match = leadingImg.firstMatch(html);
    if (match == null) return html;
    final srcMatch = RegExp(r'''src\s*=\s*["']([^"']+)''')
        .firstMatch(match.group(0)!);
    if (srcMatch?.group(1) != featureImage) return html;
    return html.substring(match.end).trimLeft();
  }

  static DateTime _parseDate(String value) {
    if (value.isEmpty) return DateTime.fromMillisecondsSinceEpoch(0);
    try {
      return HttpDate.parse(value);
    } on Object {
      return DateTime.tryParse(value) ?? DateTime.fromMillisecondsSinceEpoch(0);
    }
  }

  /// Ghost's RSS `<category>` carries the tag *name* ("off-road biking"),
  /// whereas the rest of the app keys on tag *slugs* ("off-road-biking").
  static String _slugify(String name) => name
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');

  static final _tagPattern = RegExp(r'<[^>]+>');
  static final _whitespace = RegExp(r'\s+');

  static String stripHtml(String html) => html
      .replaceAll(_tagPattern, ' ')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&apos;', "'")
      .replaceAll(_whitespace, ' ')
      .trim();
}
