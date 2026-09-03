import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pizza_predator/data/rss_post_repository.dart';
import 'package:pizza_predator/models/post_feed.dart';

const _sampleRss = '''<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/" version="2.0">
<channel>
<title><![CDATA[Pizza Predator]]></title>
<item>
  <title><![CDATA[Gravel Bike]]></title>
  <description><![CDATA[<p>I got a Trek Checkpoint.  It&apos;s my first bike.</p>]]></description>
  <link>https://www.pizzapredator.com/gravel-bike/</link>
  <guid isPermaLink="false">69098a6247eb5b00010785c9</guid>
  <category><![CDATA[biking]]></category>
  <category><![CDATA[off-road biking]]></category>
  <pubDate>Sat, 12 Apr 2025 04:12:00 GMT</pubDate>
  <media:content url="https://storage.ghost.io/img/IMG_2121.jpeg" medium="image"/>
  <content:encoded><![CDATA[<img src="https://storage.ghost.io/img/IMG_2121.jpeg"><p>Body</p>]]></content:encoded>
</item>
<item>
  <title><![CDATA[Older Post]]></title>
  <description><![CDATA[No image here]]></description>
  <link>https://www.pizzapredator.com/older/</link>
  <guid isPermaLink="false">older</guid>
  <pubDate>Mon, 03 Mar 2025 10:00:00 GMT</pubDate>
</item>
</channel>
</rss>''';

void main() {
  group('parseRss', () {
    test('maps items to posts', () {
      final posts = RssPostRepository.parseRss(_sampleRss);

      expect(posts, hasLength(2));
      final first = posts.first;
      expect(first.id, '69098a6247eb5b00010785c9');
      expect(first.title, 'Gravel Bike');
      expect(first.url, 'https://www.pizzapredator.com/gravel-bike/');
      expect(first.featureImage, 'https://storage.ghost.io/img/IMG_2121.jpeg');
      expect(first.publishedAt, DateTime.utc(2025, 4, 12, 4, 12));
      expect(first.excerpt, "I got a Trek Checkpoint. It's my first bike.");
      expect(first.html, contains('<p>Body</p>'));
    });

    test('drops the feature image Ghost prepends to the body', () {
      final post = RssPostRepository.parseRss(_sampleRss).first;
      expect(post.html, '<p>Body</p>');
    });

    test('keeps a leading image that is not the feature image', () {
      const html = '<img src="https://x/other.jpg"><p>Hi</p>';
      expect(
        RssPostRepository.stripLeadingFeatureImage(
          html,
          'https://x/feature.jpg',
        ),
        html,
      );
      expect(RssPostRepository.stripLeadingFeatureImage(html, null), html);
    });

    test('slugifies tag names', () {
      final post = RssPostRepository.parseRss(_sampleRss).first;
      expect(post.tags, ['biking', 'off-road-biking']);
    });

    test('tolerates missing image and tags', () {
      final post = RssPostRepository.parseRss(_sampleRss).last;
      expect(post.featureImage, isNull);
      expect(post.tags, isEmpty);
      expect(post.html, isEmpty);
    });
  });

  group('fetchPosts', () {
    test('merges tag feeds, de-duplicates and sorts newest first', () async {
      final requested = <String>[];
      final client = MockClient((request) async {
        requested.add(request.url.path);
        // Both tag feeds return the same post plus one unique each.
        return http.Response(_sampleRss, 200);
      });
      final repo = RssPostRepository(
        siteUrl: 'https://example.com',
        client: client,
      );

      final page = await repo.fetchPosts(PostFeed.bikes);

      expect(
        requested,
        containsAll(['/tag/biking/rss/', '/tag/off-road-biking/rss/']),
      );
      expect(page.hasMore, isFalse);
      expect(page.posts.map((p) => p.id), [
        '69098a6247eb5b00010785c9',
        'older',
      ]);
    });

    test('treats a 404 tag feed as empty', () async {
      final client = MockClient((_) async => http.Response('nope', 404));
      final repo = RssPostRepository(
        siteUrl: 'https://example.com',
        client: client,
      );

      final page = await repo.fetchPosts(PostFeed.pizza);
      expect(page.posts, isEmpty);
    });

    test('returns nothing beyond page one', () async {
      var calls = 0;
      final client = MockClient((_) async {
        calls++;
        return http.Response(_sampleRss, 200);
      });
      final repo = RssPostRepository(
        siteUrl: 'https://example.com',
        client: client,
      );

      final page = await repo.fetchPosts(PostFeed.blog, page: 2);
      expect(page.posts, isEmpty);
      expect(calls, 0);
    });
  });
}
