import 'package:bikes_pizza/models/post.dart';
import 'package:flutter_test/flutter_test.dart';

const _image = {
  'base': 'https://files.example.com/o/posts%2Fa%2Fv1%2F',
  'version': 'v1',
  'width': 2000,
  'height': 1500,
  'sizes': [400, 800],
};

void main() {
  test('a post reads its reaction tallies, ignoring what is not a count', () {
    final post = Post.fromJson({
      'slug': 'slice',
      'feed': 'pizza',
      'title': 'Slice',
      'publishedAt': '2026-09-01T12:00:00.000Z',
      'reactions': {
        'had': {'yes': 3, 'no': 'many'},
        'fantastic': 'cheese',
      },
    }, siteUrl: 'https://example.com');
    expect(post.reactions, {
      'had': {'yes': 3},
    });
    expect(post.copyWith(title: 'Big slice').reactions, post.reactions);

    final none = Post.fromJson({
      'slug': 'slice',
      'feed': 'pizza',
      'title': 'Slice',
      'publishedAt': '2026-09-01T12:00:00.000Z',
    }, siteUrl: 'https://example.com');
    expect(none.reactions, isEmpty);
  });

  test('a post reads its additional pictures, skipping broken ones', () {
    final post = Post.fromJson({
      'slug': 'a',
      'feed': 'bikes',
      'title': 'A',
      'publishedAt': '2026-01-01T00:00:00.000Z',
      'image': _image,
      'images': [
        {..._image, 'version': 'e1'},
        {'base': ''},
        {..._image, 'version': 'e2'},
      ],
    }, siteUrl: 'https://example.com');
    expect(post.images.map((i) => i.version), ['e1', 'e2']);
    expect(post.image?.version, 'v1');

    final plain = Post.fromJson({
      'slug': 'b',
      'feed': 'news',
      'title': 'B',
      'publishedAt': '2026-01-01T00:00:00.000Z',
    }, siteUrl: 'https://example.com');
    expect(plain.images, isEmpty);

    final swapped = post.copyWith(images: [post.images.last]);
    expect(swapped.images.single.version, 'e2');
    expect(post.copyWith(title: 'x').images.length, 2);
  });

  test('a post reads its comment count, times and switch', () {
    final post = Post.fromJson({
      'slug': 'slice',
      'feed': 'pizza',
      'title': 'Slice',
      'publishedAt': '2026-09-01T12:00:00.000Z',
      'commentCount': 3,
      'commentTimes': [
        '2026-09-03T12:00:00.000Z',
        7,
        '2026-09-02T12:00:00.000Z',
      ],
      'commentsEnabled': false,
    }, siteUrl: 'https://example.com');
    expect(post.commentCount, 3);
    expect(post.commentTimes, [
      DateTime.utc(2026, 9, 3, 12),
      DateTime.utc(2026, 9, 2, 12),
    ]);
    expect(post.commentsEnabled, isFalse);
    expect(post.takesComments, isTrue);
    final edited = post.copyWith(commentsEnabled: true, commentCount: 4);
    expect(edited.commentsEnabled, isTrue);
    expect(edited.commentCount, 4);
    expect(edited.commentTimes, post.commentTimes);

    final bare = Post.fromJson({
      'slug': 'news-1',
      'feed': 'news',
      'title': 'News',
      'publishedAt': '2026-09-01T12:00:00.000Z',
    }, siteUrl: 'https://example.com');
    expect(bare.commentCount, 0);
    expect(bare.commentTimes, isEmpty);
    expect(bare.commentsEnabled, isTrue);
    expect(bare.takesComments, isFalse);
  });
}
